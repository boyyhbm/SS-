export type Direction = 'left' | 'right' | 'up' | 'down';
const memories = new Map<string, { key: string; scroll: number }>();
let returnTo = { path: '/', gameId: '' };
export function rememberReturn(path: string, gameId: string) {
  if (path.startsWith('/games/')) {
    if (returnTo.gameId === gameId && ['/', '/library', '/discover'].includes(returnTo.path))
      return;
    path = '/library';
  }
  if (/^\/(library|discover|games\/[^/]+)?$/.test(path)) returnTo = { path, gameId };
}
export function consoleReturn() {
  return returnTo;
}
export class SpatialFocus {
  scope(): Document | Element {
    return (
      [...document.querySelectorAll('dialog[open]')].at(-1) ??
      document.querySelector('.pause-overlay') ??
      document
    );
  }
  elements() {
    return [
      ...this.scope().querySelectorAll<HTMLElement>(
        'a[href],button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]',
      ),
    ].filter(
      (el) =>
        el.getClientRects().length > 0 &&
        !el.closest('[inert],[aria-hidden="true"]') &&
        getComputedStyle(el).visibility !== 'hidden',
    );
  }
  move(direction: Direction) {
    const all = this.elements(),
      current = document.activeElement as HTMLElement;
    if (
      current instanceof HTMLInputElement &&
      ['range', 'number'].includes(current.type) &&
      (direction === 'left' || direction === 'right')
    ) {
      const original = current.value;
      if (direction === 'right') current.stepUp();
      else current.stepDown();
      const value = current.value;
      current.value = original;
      setNativeValue(current, value);
      return;
    }
    if (!all.includes(current)) {
      all[0]?.focus();
      return;
    }
    const r = current.getBoundingClientRect(),
      cx = r.x + r.width / 2,
      cy = r.y + r.height / 2;
    const candidates = all
      .filter((el) => el !== current)
      .map((el) => {
        const b = el.getBoundingClientRect(),
          dx = b.x + b.width / 2 - cx,
          dy = b.y + b.height / 2 - cy;
        const forward =
          direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
        const side = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
        return { el, forward, score: Math.hypot(dx, dy) + side * 3 };
      })
      .filter((v) => v.forward > 8)
      .sort((a, b) => a.score - b.score);
    const next = candidates[0]?.el;
    if (next) {
      next.focus({ preventScroll: true });
      next.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
    }
  }
  remember(path: string) {
    const el = document.activeElement as HTMLElement | null;
    const key =
      el?.dataset.focusKey ?? el?.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey;
    if (key) memories.set(path, { key, scroll: window.scrollY });
  }
  restore(path: string) {
    const entry = memories.get(path);
    if (!entry) return false;
    const el = [...document.querySelectorAll<HTMLElement>('[data-focus-key]')].find(
      (node) => node.dataset.focusKey === entry.key,
    );
    if (!el) return false;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    return true;
  }
  scroll(x: number, y: number, dt: number) {
    const active = document.activeElement as HTMLElement | null;
    let target: HTMLElement | null = active;
    while (target && target !== document.body) {
      const css = getComputedStyle(target);
      if (
        /auto|scroll/.test(css.overflowY + css.overflowX) &&
        (target.scrollHeight > target.clientHeight || target.scrollWidth > target.clientWidth)
      )
        break;
      target = target.parentElement;
    }
    const amount = Math.min(dt, 50) * 0.85;
    if (target && target !== document.body)
      target.scrollBy({ left: x * amount, top: y * amount, behavior: 'instant' });
    else window.scrollBy({ left: x * amount, top: y * amount, behavior: 'instant' });
  }
}
export function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
  );
}
export const spatialFocus = new SpatialFocus();
export function confirmWithController(message: string): Promise<boolean> {
  return new Promise((resolve) =>
    window.dispatchEvent(new CustomEvent('nexus-confirm', { detail: { message, resolve } })),
  );
}
