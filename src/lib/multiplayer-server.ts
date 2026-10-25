import { signConnectionToken } from '../../server/token';
import { ApiError } from './security';
export async function realtimeRequest(user: { id: string; tokenVersion: number }, body: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch(`${process.env.MULTIPLAYER_INTERNAL_URL ?? 'http://127.0.0.1:2567'}/control`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signConnectionToken({ sub: user.id, ver: user.tokenVersion, kind: 'control' })}` }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
  } catch { throw new ApiError(503, 'networkUnavailable'); }
  if (!res.ok) throw new ApiError(res.status, 'networkRequestRejected');
  return res.json();
}
