import type { Presence, RoomSummary } from './contracts';
export interface Person {
  id: string;
  username: string;
  avatar: string;
}
export interface SocialData {
  friends: Person[];
  incoming: { id: string; sender: Person }[];
  outgoing: { id: string; recipientId: string }[];
  invites: {
    id: string;
    kind: 'PARTY' | 'GAME';
    sender: Person;
    roomId: string | null;
    game: { id: string; slug: string; title: string } | null;
  }[];
  party: { id: string; leaderId: string; members: { userId: string; user: Person }[] } | null;
  blocked: Person[];
  privacy: { hideActivity: boolean; friendsOnlyInvites: boolean; showGamePresence: boolean };
  history: {
    id: string;
    match: { status: string; startedAt: string; game: { title: string; slug: string } };
    result: {
      place: number | null;
      timeSeconds: number | null;
      didFinish: boolean;
      serverVerified: boolean;
    } | null;
  }[];
  network: {
    self: Presence;
    friends: Record<string, Presence>;
    rooms: RoomSummary[];
    partyRoomId: string | null;
  } | null;
}
