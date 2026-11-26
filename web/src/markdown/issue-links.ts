export type IssueLinkOptions = {
  prefix: string;
  exists: (id: string) => boolean;
  href: (id: string) => string;
};

// Minimaler Ausschnitt des hast-Baums; `@types/hast` ist keine direkte Abhängigkeit.
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SKIP = new Set(['a', 'code', 'pre']);

/**
 * Rehype-Plugin, läuft nach `rehype-raw` und `rehype-sanitize`: macht aus `<prefix>-<5–6 Zeichen>`
 * in Fließtext einen Link auf das Issue, aber nur wenn die ID im Store steht. Roh eingebettetes
 * HTML ist an dieser Stelle schon echte Elemente; Text in `a`, `code` und `pre` bleibt Text.
 */
export function rehypeIssueLinks(opts: IssueLinkOptions): (tree: HastNode) => void {
  // Die Lookarounds ersetzen `\b`: ein Bindestrich davor oder danach macht die ID zum Teil eines Wortes.
  const pattern = new RegExp(
    `(?<![\\w-])${escapeRegExp(opts.prefix)}-[0-9a-hjkmnp-tv-z]{5,6}(?![\\w-])`,
    'g',
  );

  const split = (text: string): HastNode[] | undefined => {
    const out: HastNode[] = [];
    let last = 0;
    for (const m of text.matchAll(pattern)) {
      if (!opts.exists(m[0])) continue;
      if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
      out.push({
        type: 'element',
        tagName: 'a',
        properties: { href: opts.href(m[0]) },
        children: [{ type: 'text', value: m[0] }],
      });
      last = m.index + m[0].length;
    }
    if (out.length === 0) return undefined;
    if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
    return out;
  };

  const walk = (node: HastNode): void => {
    if (node.children === undefined) return;
    if (node.type === 'element' && node.tagName !== undefined && SKIP.has(node.tagName)) return;
    node.children = node.children.flatMap((child) => {
      if (child.type === 'text' && child.value !== undefined) return split(child.value) ?? [child];
      walk(child);
      return [child];
    });
  };

  return walk;
}
