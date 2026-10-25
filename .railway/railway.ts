import { defineRailway, github, image, project, service, volume } from 'railway/iac';

// Evaluating this file is local. `railway config apply` provisions billable resources:
// review its plan and obtain the owner's cost approval before applying it.
export default defineRailway((ctx) => {
  const bootstrap = process.env.NEXUS_RAILWAY_BOOTSTRAP === '1';
  const region = 'europe-west4-drams3a';
  const uploads = volume('NEXUS Uploads', { region, sizeMB: 1024 });
  const databaseData = volume('NEXUS PostgreSQL Data', { region, sizeMB: 1024 });
  const defaults = {
    region,
    numReplicas: 1,
    sleepApplication: false,
    restartPolicyType: 'ALWAYS' as const,
    limitOverride: { containers: { cpu: 1, memoryBytes: 1024 * 1024 * 1024 } },
  };
  const database = service('NEXUS Database', {
    source: image('postgres:16-alpine'),
    env: {
      POSTGRES_DB: 'nexus',
      POSTGRES_USER: 'nexus',
      POSTGRES_PASSWORD: ctx.shared.NEXUS_DATABASE_PASSWORD,
    },
    // No public domain or TCP proxy: PostgreSQL is private by construction.
    tcpProxies: [],
    domains: [],
    networking: { serviceDomains: {} },
    deploy: { ...defaults },
    volumeMounts: { '/var/lib/postgresql/data': databaseData },
  });
  const production = {
    NODE_ENV: 'production',
    NEXUS_DEPLOYMENT: 'railway',
    DATABASE_URL:
      'postgresql://nexus:${{shared.NEXUS_DATABASE_PASSWORD}}@${{NEXUS Database.RAILWAY_PRIVATE_DOMAIN}}:5432/nexus',
    NEXTAUTH_URL: ctx.shared.NEXUS_WEB_ORIGIN,
    NEXT_PUBLIC_MULTIPLAYER_URL: ctx.shared.NEXUS_MULTIPLAYER_ORIGIN,
    MULTIPLAYER_SECRET: ctx.shared.MULTIPLAYER_SECRET,
  };
  const source = bootstrap
    ? undefined
    : github('boyyhbm/SS-', { branch: 'main', checkSuites: true });
  const multiplayer = service('NEXUS Multiplayer', {
    source,
    build: { builder: 'DOCKERFILE', dockerfilePath: 'deploy/railway/Dockerfile.multiplayer' },
    env: bootstrap
      ? { PORT: '2567' }
      : { ...production, PORT: '2567', NEXUS_SERVICE: 'multiplayer' },
    deploy: {
      ...defaults,
      startCommand: 'sh deploy/start-multiplayer.sh',
      preDeployCommand: bootstrap ? [] : ['node scripts/release.mjs'],
      preDeployTimeoutSeconds: 300,
      healthcheckPath: '/live',
      healthcheckTimeout: 180,
      overlapSeconds: 0,
      drainingSeconds: 10,
    },
  });
  const web = service('NEXUS Web', {
    source,
    build: { builder: 'DOCKERFILE', dockerfilePath: 'deploy/railway/Dockerfile.web' },
    env: bootstrap
      ? { PORT: '3000' }
      : {
          ...production,
          PORT: '3000',
          NEXUS_SERVICE: 'web',
          NEXTAUTH_SECRET: ctx.shared.NEXTAUTH_SECRET,
          MULTIPLAYER_INTERNAL_URL: 'http://${{NEXUS Multiplayer.RAILWAY_PRIVATE_DOMAIN}}:2567',
          NEXUS_UPLOAD_DIR: '/data/uploads',
          TRUST_PROXY: 'false',
        },
    deploy: {
      ...defaults,
      startCommand: 'sh deploy/start-web.sh',
      preDeployCommand: bootstrap ? [] : ['node scripts/release.mjs'],
      preDeployTimeoutSeconds: 300,
      healthcheckPath: '/api/health',
      healthcheckTimeout: 180,
      requiredMountPath: '/data',
      drainingSeconds: 10,
    },
    volumeMounts: { '/data': uploads },
  });
  return project('NEXUS', { resources: [database, multiplayer, web, databaseData, uploads] });
});
