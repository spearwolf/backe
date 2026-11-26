type HastNode = { type: string; properties?: Record<string, unknown>; children?: HastNode[] };

/**
 * Rehype-Plugin nach `rehype-sanitize`: entfernt `srcSet` von jedem Element. Der Filter für
 * relative Pfade (`issueUrlTransform`) sieht `srcset` nicht, und die Kandidatenliste könnte
 * beliebige Pfade der eigenen Origin laden.
 */
export function rehypeStripSrcset(): (tree: HastNode) => void {
  const walk = (node: HastNode): void => {
    if (node.properties !== undefined) delete node.properties.srcSet;
    for (const child of node.children ?? []) walk(child);
  };
  return walk;
}
