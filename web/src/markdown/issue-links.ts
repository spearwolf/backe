import { findAndReplace } from 'mdast-util-find-and-replace';

type Tree = Parameters<typeof findAndReplace>[0];

export type IssueLinkOptions = {
  prefix: string;
  exists: (id: string) => boolean;
  href: (id: string) => string;
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Remark-Plugin: macht aus `<prefix>-<5–6 Zeichen>` einen Link auf das Issue, aber nur wenn die
 * ID im Store steht. Code, Inline-Code und bestehende Links bleiben unangetastet.
 */
export function remarkIssueLinks(opts: IssueLinkOptions): (tree: Tree) => void {
  // Die Lookarounds ersetzen `\b`: ein Bindestrich davor oder danach macht die ID zum Teil eines Wortes.
  const pattern = new RegExp(
    `(?<![\\w-])${escapeRegExp(opts.prefix)}-[0-9a-hjkmnp-tv-z]{5,6}(?![\\w-])`,
    'g',
  );
  return (tree) => {
    findAndReplace(
      tree,
      [
        pattern,
        (id: string) =>
          opts.exists(id)
            ? { type: 'link', url: opts.href(id), children: [{ type: 'text', value: id }] }
            : false,
      ],
      { ignore: ['link', 'linkReference', 'inlineCode', 'code'] },
    );
  };
}
