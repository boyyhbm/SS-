import 'next-auth';
import 'next-auth/jwt';
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      username: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      tokenVersion: number;
    };
  }
  interface User {
    username?: string;
    tokenVersion?: number;
    remember?: boolean;
  }
}
declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    username?: string;
    tokenVersion?: number;
    sessionExpires?: number;
  }
}
