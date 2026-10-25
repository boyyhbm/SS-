// Resolve only the retired bundled artwork. Administrator-uploaded art is untouched.
export function gameArtwork<
  T extends { slug: string; cover: string; banner: string; screenshots: unknown },
>(input: T) {
  const game = {
    ...input,
    screenshots: Array.isArray(input.screenshots)
      ? input.screenshots.filter((s): s is string => typeof s === 'string')
      : [],
  };
  if (game.slug === 'midnight-outlaws')
    return {
      ...game,
      cover: game.cover === '/art/midnight-cover.svg' ? '/art/midnight-keyart.webp' : game.cover,
      banner:
        game.banner === '/art/midnight-banner.svg' ? '/art/midnight-keyart.webp' : game.banner,
      screenshots: game.screenshots.map((s) =>
        s === '/art/midnight-gameplay.webp' ? '/art/midnight-gameplay-new.webp' : s,
      ),
    };
  const prefix: Record<string, string> = {
    'orbital-silence': 'orbital',
    evergreen: 'evergreen',
    'echoes-of-light': 'echoes',
  };
  const p = prefix[game.slug];
  if (!p) return game;
  return {
    ...game,
    cover: game.cover === `/art/${p}-cover.svg` ? '/art/future-concepts.webp' : game.cover,
    banner: game.banner === `/art/${p}-banner.svg` ? '/art/future-concepts.webp' : game.banner,
  };
}
