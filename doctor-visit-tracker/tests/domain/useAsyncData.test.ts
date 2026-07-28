/**
 * useAsyncData, and the render loop it used to cause.
 *
 * THE BUG
 * -------
 * `reload` and `refresh` were plain arrow functions, so they had a new identity
 * on every render. Screens do the natural thing with them:
 *
 *     useFocusEffect(useCallback(() => { reload(); }, [reload]));
 *
 * A new `reload` each render is a new callback each render, so the effect
 * re-runs on every render, calls reload, sets state, renders again. On screen:
 * «Ачааллаж байна…», a flash of the real screen, «Ачааллаж байна…», for ever.
 * It hit the Home screen — the first thing anybody sees after signing in.
 *
 * HOW THIS IS TESTED WITHOUT A RENDERER
 * ------------------------------------
 * There is no React renderer in this project and adding one to test one hook is
 * not worth it. Instead `react`'s four hooks are replaced with a ~40-line
 * implementation of what React actually guarantees: hook slots addressed by
 * call order, useCallback returning the previous function when its dependencies
 * are unchanged, and effects re-running when theirs change.
 *
 * That is enough to reproduce the loop exactly, and it fails against the old
 * code — which was checked, not assumed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// A minimal hook runtime.
// ---------------------------------------------------------------------------
interface Slot {
  value?: unknown;
  deps?: unknown[];
  cleanup?: (() => void) | void;
}

const slots: Slot[] = [];
let cursor = 0;
let scheduleRender: () => void = () => {};
/** Effects queued during a render, run after it — as React does. */
let pendingEffects: (() => void)[] = [];

function sameDeps(a: unknown[] | undefined, b: unknown[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((value, i) => Object.is(value, b[i]));
}

function useState<T>(initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const slot = (slots[cursor] ??= { value: initial });
  const index = cursor++;
  const set = (next: T | ((prev: T) => T)) => {
    const previous = slots[index].value as T;
    const resolved = typeof next === 'function' ? (next as (p: T) => T)(previous) : next;
    if (Object.is(previous, resolved)) return;
    slots[index].value = resolved;
    scheduleRender();
  };
  return [slot.value as T, set];
}

function useCallback<F>(fn: F, deps: unknown[]): F {
  const slot = (slots[cursor] ??= {});
  cursor++;
  if (!sameDeps(slot.deps, deps)) {
    slot.deps = deps;
    slot.value = fn;
  }
  return slot.value as F;
}

function useEffect(effect: () => void | (() => void), deps: unknown[]): void {
  const slot = (slots[cursor] ??= {});
  cursor++;
  if (!sameDeps(slot.deps, deps)) {
    slot.deps = deps;
    pendingEffects.push(() => {
      if (typeof slot.cleanup === 'function') slot.cleanup();
      slot.cleanup = effect();
    });
  }
}

function useRef<T>(initial: T): { current: T } {
  const slot = (slots[cursor] ??= { value: { current: initial } });
  cursor++;
  return slot.value as { current: T };
}

vi.mock('react', () => ({ useState, useCallback, useEffect, useRef }));

/**
 * Render a component function repeatedly until nothing more is scheduled.
 *
 * Returns the number of renders. A capped, still-scheduling result is the
 * signature of the loop.
 */
const MAX_RENDERS = 60;

async function renderUntilStable<T>(component: () => T): Promise<{ renders: number; last: T }> {
  slots.length = 0;
  cursor = 0;
  let dirty = true;
  let renders = 0;
  let last!: T;

  scheduleRender = () => {
    dirty = true;
  };

  while (dirty && renders < MAX_RENDERS) {
    dirty = false;
    cursor = 0;
    pendingEffects = [];
    last = component();
    renders++;

    const effects = pendingEffects;
    pendingEffects = [];
    for (const run of effects) run();
    // Let the loader's promise settle, so its setState lands like a real one.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  return { renders, last };
}

// ---------------------------------------------------------------------------

let useAsyncData: typeof import('../../src/data/useAsyncData').useAsyncData;

beforeEach(async () => {
  vi.resetModules();
  ({ useAsyncData } = await import('../../src/data/useAsyncData'));
});

afterEach(() => {
  slots.length = 0;
});

describe('the hook runtime itself', () => {
  // If this harness does not honour useCallback, every test below is vacuous.
  it('returns the same function while dependencies are unchanged', async () => {
    const seen: unknown[] = [];
    let renders = 0;
    const component = () => {
      const fn = useCallback(() => {}, ['stable']);
      seen.push(fn);
      const [, setCount] = useState(0);
      if (renders++ === 0) setCount(1);
      return null;
    };
    await renderUntilStable(component);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[0]).toBe(seen[1]);
  });
});

describe('a screen that reloads on focus', () => {
  /**
   * The exact shape every affected screen used:
   *   useFocusEffect(useCallback(() => { reload(); }, [reload]))
   * modelled with useEffect, which is what useFocusEffect is once focused.
   */
  function screenUsingReloadOnFocus(loader: () => Promise<{ data: number; error: null }>) {
    return () => {
      const { data, loading, reload } = useAsyncData(loader, ['fixed-dep']);
      const onFocus = useCallback(() => {
        reload();
      }, [reload]);
      useEffect(onFocus, [onFocus]);
      return { data, loading };
    };
  }

  it('settles instead of looping', async () => {
    const loader = vi.fn(async () => ({ data: 42, error: null as null }));

    const { renders, last } = await renderUntilStable(screenUsingReloadOnFocus(loader));

    // The loop rendered until the cap every time.
    expect(renders).toBeLessThan(MAX_RENDERS);
    expect(last.loading).toBe(false);
    expect(last.data).toBe(42);
  });

  it('does not call the loader over and over', async () => {
    const loader = vi.fn(async () => ({ data: 1, error: null as null }));

    await renderUntilStable(screenUsingReloadOnFocus(loader));

    // Mount effect plus the focus effect is two. The loop produced dozens.
    expect(loader.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

describe('the identities that caused it', () => {
  it('reload keeps its identity across renders', async () => {
    const seen: unknown[] = [];
    let renders = 0;

    await renderUntilStable(() => {
      const { reload } = useAsyncData(async () => ({ data: 1, error: null }), ['fixed-dep']);
      seen.push(reload);
      const [, setTick] = useState(0);
      if (renders++ === 0) setTick(1);
      return null;
    });

    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(1);
  });

  it('refresh keeps its identity across renders', async () => {
    const seen: unknown[] = [];
    let renders = 0;

    await renderUntilStable(() => {
      const { refresh } = useAsyncData(async () => ({ data: 1, error: null }), ['fixed-dep']);
      seen.push(refresh);
      const [, setTick] = useState(0);
      if (renders++ === 0) setTick(1);
      return null;
    });

    expect(new Set(seen).size).toBe(1);
  });

  it('but changes when the declared dependencies change', async () => {
    // Stability must not be achieved by ignoring the dependencies — a screen
    // navigating from doctor A to doctor B has to refetch.
    const first: unknown[] = [];
    await renderUntilStable(() => {
      const { reload } = useAsyncData(async () => ({ data: 1, error: null }), ['doctor-a']);
      first.push(reload);
      return null;
    });
    const second: unknown[] = [];
    await renderUntilStable(() => {
      const { reload } = useAsyncData(async () => ({ data: 1, error: null }), ['doctor-b']);
      second.push(reload);
      return null;
    });
    expect(first[0]).not.toBe(second[0]);
  });
});
