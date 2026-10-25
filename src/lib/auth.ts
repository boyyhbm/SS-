import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { db } from './db';
import { loginSchema } from './validation';
import { verifyPassword } from './password';
import { rateLimit, ApiError } from './security';
const dummyHash = 'scrypt:00000000000000000000000000000000:' + '00'.repeat(64);
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      name: 'NEXUS',
      credentials: {
        email: { type: 'email' },
        password: { type: 'password' },
        remember: { type: 'text' },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password, remember } = parsed.data;
        try {
          await rateLimit(`login:${email}`, 12);
          await rateLimit('login:global', 300);
        } catch {
          return null;
        }
        const user = await db.user.findUnique({ where: { email } });
        const valid = await verifyPassword(password, user?.passwordHash ?? dummyHash);
        if (!user || !valid) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.username,
          username: user.username,
          tokenVersion: user.tokenVersion,
          remember: remember === 'true',
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = user.username;
        token.tokenVersion = user.tokenVersion;
        token.sessionExpires = Date.now() + (user.remember ? 30 : 1) * 86400000;
      }
      if (!token.sessionExpires || Date.now() > token.sessionExpires) return {};
      return token;
    },
    async session({ session, token }) {
      session.user = {
        ...session.user,
        id: token.id ?? '',
        username: token.username ?? '',
        tokenVersion: token.tokenVersion ?? -1,
      };
      if (token.sessionExpires) session.expires = new Date(token.sessionExpires).toISOString();
      return session;
    },
  },
  logger: {
    error() {
      console.error('Authentication service error');
    },
    warn() {},
    debug() {},
  },
};
export async function currentUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { settings: true },
  });
  return user && user.tokenVersion === session.user.tokenVersion ? user : null;
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new ApiError(401, 'signInRequired');
  return user;
}
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== 'ADMIN') throw new ApiError(403, 'accessDenied');
  return user;
}
