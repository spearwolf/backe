/**
 * jsdom kennt weder `ResizeObserver` noch `DOMMatrixReadOnly` und misst keine Elemente. xyflow
 * braucht alle drei, um Knoten zu vermessen und Kanten an ihre Handles zu hängen. Die Stubs
 * melden jede Beobachtung sofort und geben Elementen die Maße aus ihrem Inline-Style, sonst eine
 * feste Fläche.
 *
 * Grenze: user-event gibt Maus-Events kein `view`, d3-zoom braucht es beim `mousedown` auf der
 * Fläche. Klicks auf Elemente ohne Klasse `nopan` gehen darum per `fireEvent.click`.
 */

const FALLBACK = { width: 800, height: 384 } as const;

class ResizeObserverStub {
  readonly #cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.#cb = cb;
  }
  observe(target: Element): void {
    this.#cb([{ target } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve(): void {}
  disconnect(): void {}
}

/** xyflow liest nur den Zoom (`m22`) aus dem `transform` des Viewports. */
class DOMMatrixReadOnlyStub {
  readonly m22: number;
  constructor(transform?: string) {
    const scale = /scale\(([-\d.]+)\)/.exec(transform ?? '');
    this.m22 = scale ? Number(scale[1]) : 1;
  }
}

/** Feste Inline-Maße (`224px`, `0`) gelten; ohne oder relativ (`100%`) die feste Fläche. */
const size = (el: HTMLElement, key: 'width' | 'height'): number => {
  const value = el.style[key];
  return /^\d+(\.\d+)?(px)?$/.test(value) ? Number.parseFloat(value) : FALLBACK[key];
};

/** Installiert die Stubs; die Rückgabe stellt den vorigen Zustand wieder her. */
export function installXyflowStubs(): () => void {
  const proto = HTMLElement.prototype;
  const saved = {
    offsetWidth: Object.getOwnPropertyDescriptor(proto, 'offsetWidth'),
    offsetHeight: Object.getOwnPropertyDescriptor(proto, 'offsetHeight'),
  };
  Object.defineProperty(proto, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return size(this, 'width');
    },
  });
  Object.defineProperty(proto, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return size(this, 'height');
    },
  });
  // Nur diese beiden Globals; `vi.unstubAllGlobals` träfe auch Stubs des Testfalls.
  const g = globalThis as Record<string, unknown>;
  const globals = {
    ResizeObserver: Object.getOwnPropertyDescriptor(g, 'ResizeObserver'),
    DOMMatrixReadOnly: Object.getOwnPropertyDescriptor(g, 'DOMMatrixReadOnly'),
  };
  g.ResizeObserver = ResizeObserverStub;
  g.DOMMatrixReadOnly = DOMMatrixReadOnlyStub;

  return () => {
    for (const [key, desc] of Object.entries(globals)) {
      if (desc) Object.defineProperty(g, key, desc);
      else delete g[key];
    }
    for (const [key, desc] of Object.entries(saved)) {
      if (desc) Object.defineProperty(proto, key, desc);
      else delete (proto as unknown as Record<string, unknown>)[key];
    }
  };
}
