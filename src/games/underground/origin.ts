export function undergroundOrigin(appOrigin: string) {
  const app = new URL(appOrigin);
  const raw =
    process.env.NEXT_PUBLIC_NFSU_RUNTIME_ORIGIN ??
    process.env.NEXT_PUBLIC_MULTIPLAYER_URL ??
    'ws://localhost:2567';
  const url = new URL(raw.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'));
  const local = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
  if (
    url.username ||
    url.password ||
    !['https:', 'http:'].includes(url.protocol) ||
    (url.protocol === 'http:' && !local(url.hostname))
  )
    throw Error('Underground runtime requires HTTPS or loopback.');
  if (url.hostname === app.hostname) {
    if (local(app.hostname) && url.protocol === 'http:')
      url.hostname = app.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    else
      throw Error(
        'The game runtime must use a different host; NEXUS authentication cookies must not be shared.',
      );
  }
  return url.origin;
}
