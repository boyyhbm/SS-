import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { api, ApiError, assertSameOrigin, rateLimit, readJson } from '@/lib/security';
import { realtimeRequest } from '@/lib/multiplayer-server';
const person = { id: true, username: true, avatar: true } as const;
const schema = z
  .object({
    action: z.enum([
      'request',
      'accept',
      'decline',
      'remove',
      'block',
      'unblock',
      'partyCreate',
      'partyInvite',
      'partyAccept',
      'partyLeave',
      'partyLeader',
      'gameInvite',
      'inviteDecline',
      'privacy',
    ]),
    userId: z.string().max(64).optional(),
    id: z.string().max(64).optional(),
    username: z.string().trim().toLowerCase().min(3).max(24).optional(),
    roomId: z.string().max(64).optional(),
    hideActivity: z.boolean().optional(),
    friendsOnlyInvites: z.boolean().optional(),
    showGamePresence: z.boolean().optional(),
  })
  .strict();
const pair = (a: string, b: string) => ({ userAId: a < b ? a : b, userBId: a < b ? b : a });
function needed(value: string | undefined) {
  if (!value) throw new ApiError(400, 'invalidInput');
  return value;
}
async function transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034' && attempt < 3)
        continue;
      throw e;
    }
  }
}
async function mayInvite(
  tx: Prisma.TransactionClient,
  from: string,
  to: string,
  friendsRequired = false,
) {
  if (from === to) throw new ApiError(400, 'invalidInput');
  const target = await tx.user.findUnique({ where: { id: to }, select: { settings: true } });
  if (
    !target ||
    (await tx.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: from, blockedId: to },
          { blockerId: to, blockedId: from },
        ],
      },
    }))
  )
    throw new ApiError(403, 'socialNotAllowed');
  const friend = await tx.friendship.findUnique({ where: { userAId_userBId: pair(from, to) } });
  if ((friendsRequired || (target.settings?.friendsOnlyInvites ?? true)) && !friend)
    throw new ApiError(403, 'socialNotAllowed');
}
async function leaveParty(tx: Prisma.TransactionClient, userId: string) {
  const member = await tx.partyMember.findUnique({ where: { userId }, include: { party: true } });
  if (!member) return;
  await tx.partyMember.delete({ where: { userId } });
  const next = await tx.partyMember.findFirst({
    where: { partyId: member.partyId },
    orderBy: { joinedAt: 'asc' },
  });
  if (!next) await tx.party.delete({ where: { id: member.partyId } });
  else if (member.party.leaderId === userId)
    await tx.party.update({ where: { id: member.partyId }, data: { leaderId: next.userId } });
}
export async function GET(request: Request) {
  return api(async () => {
    const user = await requireUser();
    const query = new URL(request.url).searchParams.get('q');
    if (query !== null) {
      await rateLimit(`social-search:${user.id}`, 60, 60);
      const q = z.string().trim().toLowerCase().min(3).max(24).parse(query);
      const blocks = await db.userBlock.findMany({
        where: { OR: [{ blockerId: user.id }, { blockedId: user.id }] },
      });
      const excluded = [user.id, ...blocks.flatMap((b) => [b.blockerId, b.blockedId])];
      return Response.json({
        users: await db.user.findMany({
          where: { username: { contains: q }, id: { notIn: excluded } },
          select: person,
          take: 12,
          orderBy: { username: 'asc' },
        }),
      });
    }
    const [links, incoming, outgoing, invites, membership, blocked, history] = await Promise.all([
      db.friendship.findMany({
        where: { OR: [{ userAId: user.id }, { userBId: user.id }] },
        include: { userA: { select: person }, userB: { select: person } },
      }),
      db.friendRequest.findMany({
        where: { recipientId: user.id },
        include: { sender: { select: person } },
      }),
      db.friendRequest.findMany({
        where: { senderId: user.id },
        select: { id: true, recipientId: true },
      }),
      db.gameInvite.findMany({
        where: { recipientId: user.id, expiresAt: { gt: new Date() }, acceptedAt: null },
        include: {
          sender: { select: person },
          game: { select: { id: true, slug: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      db.partyMember.findUnique({
        where: { userId: user.id },
        include: {
          party: {
            include: {
              members: { include: { user: { select: person } }, orderBy: { joinedAt: 'asc' } },
            },
          },
        },
      }),
      db.userBlock.findMany({
        where: { blockerId: user.id },
        include: { blocked: { select: person } },
      }),
      db.matchParticipant.findMany({
        where: { userId: user.id },
        include: {
          match: { include: { game: { select: { title: true, slug: true } } } },
          result: true,
        },
        orderBy: { match: { startedAt: 'desc' } },
        take: 20,
      }),
    ]);
    let network = null;
    try {
      network = await realtimeRequest(user, { action: 'status' });
    } catch {
      /* Social history remains available during game server downtime. */
    }
    return Response.json(
      {
        friends: links.map((l) => (l.userAId === user.id ? l.userB : l.userA)),
        incoming,
        outgoing,
        invites,
        party: membership?.party ?? null,
        blocked: blocked.map((b) => b.blocked),
        history,
        privacy: {
          hideActivity: user.settings?.hideActivity ?? false,
          friendsOnlyInvites: user.settings?.friendsOnlyInvites ?? true,
          showGamePresence: user.settings?.showGamePresence ?? true,
        },
        network,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  });
}
export async function POST(request: Request) {
  return api(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    await rateLimit(`social:${user.id}`, 60, 60);
    const body = schema.parse(await readJson(request));
    if (['request', 'partyInvite', 'gameInvite'].includes(body.action))
      await rateLimit(`social-invite:${user.id}`, 15, 60);
    const roomPermission =
      body.action === 'gameInvite'
        ? await realtimeRequest(user, { action: 'authorizeInvite', roomId: needed(body.roomId) })
        : null;
    await transaction(async (tx) => {
      if (body.action === 'privacy') {
        const settings = {
          hideActivity: z.boolean().parse(body.hideActivity),
          friendsOnlyInvites: z.boolean().parse(body.friendsOnlyInvites),
          showGamePresence: z.boolean().parse(body.showGamePresence),
        };
        await tx.userSettings.upsert({
          where: { userId: user.id },
          create: { userId: user.id, ...settings },
          update: settings,
        });
        return;
      }
      if (body.action === 'request') {
        const target = await tx.user.findUnique({
          where: { username: needed(body.username) },
          select: person,
        });
        if (!target || target.id === user.id) throw new ApiError(404, 'userNotFound');
        if (
          await tx.userBlock.findFirst({
            where: {
              OR: [
                { blockerId: user.id, blockedId: target.id },
                { blockerId: target.id, blockedId: user.id },
              ],
            },
          })
        )
          throw new ApiError(403, 'socialNotAllowed');
        if (
          await tx.friendship.findUnique({ where: { userAId_userBId: pair(user.id, target.id) } })
        )
          return;
        if (
          await tx.friendRequest.findUnique({
            where: { senderId_recipientId: { senderId: target.id, recipientId: user.id } },
          })
        )
          throw new ApiError(409, 'requestAlreadyReceived');
        await tx.friendRequest.upsert({
          where: { senderId_recipientId: { senderId: user.id, recipientId: target.id } },
          create: { senderId: user.id, recipientId: target.id },
          update: {},
        });
        return;
      }
      if (body.action === 'accept' || body.action === 'decline') {
        const invite = await tx.friendRequest.findFirst({
          where: { id: needed(body.id), recipientId: user.id },
        });
        if (!invite) throw new ApiError(404, 'invalidInput');
        if (body.action === 'accept') {
          if (
            await tx.userBlock.findFirst({
              where: {
                OR: [
                  { blockerId: user.id, blockedId: invite.senderId },
                  { blockerId: invite.senderId, blockedId: user.id },
                ],
              },
            })
          )
            throw new ApiError(403, 'socialNotAllowed');
          const p = pair(user.id, invite.senderId);
          await tx.friendship.upsert({ where: { userAId_userBId: p }, create: p, update: {} });
        }
        await tx.friendRequest.delete({ where: { id: invite.id } });
        return;
      }
      if (['remove', 'block', 'unblock'].includes(body.action)) {
        const target = needed(body.userId);
        if (target === user.id) throw new ApiError(400, 'invalidInput');
        if (body.action === 'unblock') {
          await tx.userBlock.deleteMany({ where: { blockerId: user.id, blockedId: target } });
          return;
        }
        await tx.friendship.deleteMany({ where: pair(user.id, target) });
        await tx.friendRequest.deleteMany({
          where: {
            OR: [
              { senderId: user.id, recipientId: target },
              { senderId: target, recipientId: user.id },
            ],
          },
        });
        await tx.gameInvite.deleteMany({
          where: {
            OR: [
              { senderId: user.id, recipientId: target },
              { senderId: target, recipientId: user.id },
            ],
          },
        });
        if (body.action === 'block') {
          await tx.userBlock.upsert({
            where: { blockerId_blockedId: { blockerId: user.id, blockedId: target } },
            create: { blockerId: user.id, blockedId: target },
            update: {},
          });
          const a = await tx.partyMember.findUnique({ where: { userId: user.id } });
          const b = await tx.partyMember.findUnique({ where: { userId: target } });
          if (a && b && a.partyId === b.partyId) await leaveParty(tx, user.id);
        }
        return;
      }
      if (body.action === 'partyCreate') {
        if (await tx.partyMember.findUnique({ where: { userId: user.id } }))
          throw new ApiError(409, 'alreadyInParty');
        await tx.party.create({
          data: { leaderId: user.id, members: { create: { userId: user.id } } },
        });
        return;
      }
      if (body.action === 'partyLeave') {
        await leaveParty(tx, user.id);
        return;
      }
      if (body.action === 'partyLeader') {
        const member = await tx.partyMember.findUnique({
          where: { userId: user.id },
          include: { party: true },
        });
        const target = await tx.partyMember.findUnique({ where: { userId: needed(body.userId) } });
        if (!member || member.party.leaderId !== user.id || target?.partyId !== member.partyId)
          throw new ApiError(403, 'socialNotAllowed');
        await tx.party.update({ where: { id: member.partyId }, data: { leaderId: target.userId } });
        return;
      }
      if (body.action === 'partyInvite' || body.action === 'gameInvite') {
        const target = needed(body.userId);
        await mayInvite(tx, user.id, target, body.action === 'partyInvite');
        let partyId: string | undefined;
        if (body.action === 'partyInvite') {
          const member = await tx.partyMember.findUnique({
            where: { userId: user.id },
            include: { party: { include: { members: true } } },
          });
          if (!member || member.party.leaderId !== user.id || member.party.members.length >= 6)
            throw new ApiError(403, 'socialNotAllowed');
          partyId = member.partyId;
        }
        if (
          await tx.gameInvite.findFirst({
            where: {
              senderId: user.id,
              recipientId: target,
              kind: body.action === 'partyInvite' ? 'PARTY' : 'GAME',
              acceptedAt: null,
              expiresAt: { gt: new Date() },
            },
          })
        )
          return;
        await tx.gameInvite.create({
          data: {
            senderId: user.id,
            recipientId: target,
            kind: body.action === 'partyInvite' ? 'PARTY' : 'GAME',
            partyId,
            gameId: roomPermission?.gameId,
            roomId: body.action === 'gameInvite' ? needed(body.roomId) : undefined,
            expiresAt: new Date(Date.now() + 5 * 60000),
          },
        });
        return;
      }
      const invite = await tx.gameInvite.findFirst({
        where: {
          id: needed(body.id),
          recipientId: user.id,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!invite) throw new ApiError(404, 'invalidInput');
      if (body.action === 'inviteDecline') {
        await tx.gameInvite.delete({ where: { id: invite.id } });
        return;
      }
      if (body.action === 'partyAccept' && invite.kind === 'PARTY' && invite.partyId) {
        await mayInvite(tx, invite.senderId, user.id, true);
        if (await tx.partyMember.findUnique({ where: { userId: user.id } }))
          throw new ApiError(409, 'alreadyInParty');
        if ((await tx.partyMember.count({ where: { partyId: invite.partyId } })) >= 6)
          throw new ApiError(409, 'partyFull');
        const peers = await tx.partyMember.findMany({ where: { partyId: invite.partyId } });
        for (const peer of peers) {
          if (
            await tx.userBlock.findFirst({
              where: {
                OR: [
                  { blockerId: user.id, blockedId: peer.userId },
                  { blockerId: peer.userId, blockedId: user.id },
                ],
              },
            })
          )
            throw new ApiError(403, 'socialNotAllowed');
        }
        await tx.partyMember.create({ data: { userId: user.id, partyId: invite.partyId } });
        await tx.gameInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
        return;
      }
      throw new ApiError(400, 'invalidInput');
    });
    return Response.json({ ok: true });
  });
}
