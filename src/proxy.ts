import { getToken } from 'next-auth/jwt';
import { NextResponse, type NextRequest } from 'next/server';
export async function proxy(request: NextRequest) {
  const protectedPath = /^\/(library|profile|admin|play|friends|online)(\/|$)/.test(
    request.nextUrl.pathname,
  );
  if (protectedPath) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.id || !token.sessionExpires || Date.now() > token.sessionExpires) {
      const url = new URL('/login', request.url);
      url.searchParams.set('next', request.nextUrl.pathname);
      return NextResponse.redirect(url);
    }
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';
  const realtime = new URL(process.env.NEXT_PUBLIC_MULTIPLAYER_URL ?? 'ws://localhost:2567');
  const realtimeOrigin = ['ws:', 'wss:'].includes(realtime.protocol) ? realtime.origin : '';
  const realtimeHttp = realtimeOrigin.replace(/^ws/, 'http');
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' blob: ${realtimeOrigin} ${realtimeHttp}${dev ? ' ws: wss:' : ''}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|game-assets/|art/|icon.svg|favicon.ico).*)'],
};
