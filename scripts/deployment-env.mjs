export function isPreparation(env) {
  return env.NEXUS_DEPLOYMENT === 'render' && env.NEXUS_LIVE !== '1';
}

// Independent of the build: a destination can be built and health-checked before
// the production backup is restored, without opening an empty replacement site.
export function isMigrationHold(env) {
  const value = env.NEXUS_MIGRATION_HOLD;
  if (value !== undefined && !['0', '1'].includes(value))
    throw Error('NEXUS_MIGRATION_HOLD must be 0 or 1');
  if (env.NEXUS_DEPLOYMENT === 'northflank' && value === undefined)
    throw Error('Northflank requires an explicit NEXUS_MIGRATION_HOLD');
  return value === '1';
}

// Use assigned origins, never guess provider domains. Render also supplies the
// external URL on the web container; Northflank uses the explicit shared values.
export function deploymentEnvironment(source) {
  const env = { ...source };
  if (!['render', 'northflank'].includes(env.NEXUS_DEPLOYMENT)) return env;
  const webOrigin =
    env.NEXUS_WEB_ORIGIN ||
    (env.NEXUS_DEPLOYMENT === 'render' && env.NEXUS_SERVICE === 'web'
      ? env.RENDER_EXTERNAL_URL
      : undefined);
  if (!env.NEXTAUTH_URL && webOrigin) env.NEXTAUTH_URL = webOrigin;
  if (!env.NEXT_PUBLIC_MULTIPLAYER_URL && env.NEXUS_MULTIPLAYER_ORIGIN) {
    let url;
    try {
      url = new URL(env.NEXUS_MULTIPLAYER_ORIGIN);
    } catch {
      throw Error('NEXUS_MULTIPLAYER_ORIGIN must be an HTTPS origin');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw Error('NEXUS_MULTIPLAYER_ORIGIN must be an HTTPS origin');
    url.protocol = 'wss:';
    env.NEXT_PUBLIC_MULTIPLAYER_URL = url.origin;
  }
  if (!env.MULTIPLAYER_INTERNAL_URL && env.NEXUS_MULTIPLAYER_PRIVATE_HOSTPORT)
    env.MULTIPLAYER_INTERNAL_URL = `http://${env.NEXUS_MULTIPLAYER_PRIVATE_HOSTPORT}`;
  return env;
}

export function buildEnvironment(source) {
  const env = deploymentEnvironment(source);
  if (['render', 'northflank'].includes(env.NEXUS_DEPLOYMENT) && !isPreparation(env)) {
    let url;
    try {
      url = new URL(env.NEXT_PUBLIC_MULTIPLAYER_URL);
    } catch {
      throw Error('Set the actual multiplayer HTTPS origin before rebuilding the live website');
    }
    if (
      url.protocol !== 'wss:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !url.hostname.includes('.') ||
      url.hostname.endsWith('.internal') ||
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
      throw Error('The live client build requires a public WSS origin');
  }
  return env;
}
