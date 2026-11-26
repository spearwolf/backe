import type { Attachment } from '@backe/core/schemas.ts';
import { type ComponentProps, useMemo } from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGemoji from 'remark-gemoji';
import remarkGfm from 'remark-gfm';
import { useLinkClick } from '../app/router.ts';
import { routeHref } from '../app/routes.ts';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { remarkIssueLinks } from './issue-links.ts';
import { issueUrlTransform } from './url-transform.ts';
import './markdown.css';

export type MarkdownProps = {
  source: string;
  backlog: string;
  /** Kontext für relative Pfade; ohne ihn (Projekt, Sprint, Repo) fallen relative Pfade weg. */
  issue?: { id: string; attachments: readonly Attachment[] };
  className?: string;
};

function Anchor({
  href,
  children,
  node: _node,
  ...rest
}: ComponentProps<'a'> & { node?: unknown }) {
  const click = useLinkClick();
  if (href?.startsWith('/b/')) {
    return (
      <a {...rest} href={href} onClick={click(href)}>
        {children}
      </a>
    );
  }
  if (href !== undefined && /^https?:/i.test(href)) {
    return (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <a {...rest} href={href}>
      {children}
    </a>
  );
}

// Einzige Stelle für Code: Task-Listen bleiben lesend (`disabled` setzt remark-gfm), und hier
// tauscht der Codeblock-Renderer später `language-*` gegen Highlighting und Diagramme.
function Code({ node: _node, ...rest }: ComponentProps<'code'> & { node?: unknown }) {
  return <code {...rest} />;
}

const components: Components = { a: Anchor, code: Code };

export default function Markdown({ source, backlog, issue, className }: MarkdownProps) {
  const store = useStore();
  const config = useSignal(store.config);
  const keys = useSignal(store.issues.keys);
  const prefix = config?.id_prefix;
  const attachments = issue?.attachments;
  const issueId = issue?.id;

  const remarkPlugins = useMemo((): NonNullable<Options['remarkPlugins']> => {
    const known = new Set(keys);
    const plugins: NonNullable<Options['remarkPlugins']> = [remarkGfm, remarkGemoji];
    if (prefix !== undefined) {
      plugins.push([
        remarkIssueLinks,
        {
          prefix,
          exists: (id: string) => known.has(id),
          href: (id: string) => routeHref({ kind: 'issue', backlog, id }),
        },
      ]);
    }
    return plugins;
  }, [keys, prefix, backlog]);

  const urlTransform = useMemo(
    () =>
      issueUrlTransform({
        backlog,
        issue:
          issueId === undefined || attachments === undefined
            ? undefined
            : { id: issueId, attachments },
      }),
    [backlog, issueId, attachments],
  );

  return (
    <div className={`markdown ${className ?? ''}`.trim()}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, defaultSchema]]}
        urlTransform={urlTransform}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
