/**
 * Ein `IntersectionObserver`, der beobachtet, aber nie einen Schnitt meldet: wie ein Browser, in
 * dem das Beobachtete außerhalb des Viewports bleibt. Die Prüfstände des Tabs Issue stubben ihn,
 * weil jsdom keinen kennt und Lazy-Teile wie der Graph-Chunk ohne ihn sofort laden. Wer das Laden
 * prüft, stubbt einen eigenen.
 */
export class InertIntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds: readonly number[] = [0];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
