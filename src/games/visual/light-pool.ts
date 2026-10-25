// Reordering the nearest fixtures must never move lights already illuminating
// those fixtures. Preserve current assignments, then pending fade targets.
export function stableLightTargets<T>(
  slots: readonly { current?: T; target?: T }[],
  nearest: readonly T[],
): T[] {
  const selected: (T | undefined)[] = Array(slots.length).fill(undefined),
    used = new Set<T>();
  for (const key of ['current', 'target'] as const)
    for (let i = 0; i < slots.length; i++) {
      const fixture = slots[i][key];
      if (
        selected[i] === undefined &&
        fixture !== undefined &&
        nearest.includes(fixture) &&
        !used.has(fixture)
      ) {
        selected[i] = fixture;
        used.add(fixture);
      }
    }
  for (let i = 0; i < slots.length; i++)
    if (selected[i] === undefined) {
      const fixture = nearest.find((f) => !used.has(f));
      if (fixture !== undefined) {
        selected[i] = fixture;
        used.add(fixture);
      }
    }
  return selected as T[];
}
