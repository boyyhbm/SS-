import NextAuth from 'next-auth';
import { NextRequest } from 'next/server';
import { authOptions } from '@/lib/auth';
import { api, readLimitedBody } from '@/lib/security';
const handler = NextAuth(authOptions);
export const GET = handler;
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> },
) {
  return api(async () => {
    const body = await readLimitedBody(request, 8192);
    const bounded = new NextRequest(request.url, {
      method: 'POST',
      headers: request.headers,
      body,
    });
    return handler(bounded, context);
  });
}
