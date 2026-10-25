const web = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const game = process.env.TEST_GAME_HEALTH_URL ?? 'http://localhost:2567/health';
const deadline = Date.now() + 120000;
while (Date.now() < deadline) {
  try {
    const responses = await Promise.all([
      fetch(`${web}/api/health`, { signal: AbortSignal.timeout(3000) }),
      fetch(game, { signal: AbortSignal.timeout(3000) }),
    ]);
    if (responses.every((r) => r.ok)) {
      console.log('Web/database and multiplayer ready');
      process.exit(0);
    }
  } catch {
    /* Services are still starting. */
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
console.error('Services did not become ready');
process.exitCode = 1;
