import type { Attachment } from '@backe/core/schemas.ts';
import { ImageOff } from 'lucide-react';
import {
  Children,
  type ComponentProps,
  createContext,
  isValidElement,
  memo,
  type ReactNode,
  useContext,
  useMemo,
} from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGemoji from 'remark-gemoji';
import remarkGfm from 'remark-gfm';
import { useLinkClick } from '../app/router.ts';
import { routeHref } from '../app/routes.ts';
import { useExternalImages } from '../app/ui-context.tsx';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { CodeBlock } from './CodeBlock.tsx';
import { rehypeIssueLinks } from './issue-links.ts';
import { MermaidBlock } from './MermaidBlock.tsx';
import { m } from './markdown.messages.ts';
import { rehypeStripSrcset } from './strip-srcset.ts';
import { issueUrlTransform } from './url-transform.ts';
import './markdown.css';

export type MarkdownProps = {
  source: string;
  backlog: string;
  /** Kontext für relative Pfade; ohne ihn (Projekt, Sprint, Repo) fallen relative Pfade weg. */
  issue?: { id: string; attachments: readonly Attachment[] };
  /** `file` → `blob:`-URL für noch nicht hochgeladene Bilder (Editor-Vorschau). */
  local?: ReadonlyMap<string, string>;
  className?: string;
};

/** Steht ein Bild schon in einem Link (Badges), darf es keinen eigenen aufmachen: `<a>` in `<a>`. */
const InLink = createContext(false);

function Anchor({
  href,
  children,
  node: _node,
  ...rest
}: ComponentProps<'a'> & { node?: unknown }) {
  const click = useLinkClick();
  // Nahm der URL-Filter dem Link sein Ziel, ist er keiner mehr: Ein gesperrtes Bild darin behält
  // dann seinen eigenen Link, statt nur als Hinweis ohne Ziel dazustehen.
  const inner =
    href === undefined ? children : <InLink.Provider value={true}>{children}</InLink.Provider>;
  if (href?.startsWith('/b/')) {
    return (
      <a {...rest} href={href} onClick={click(href)}>
        {inner}
      </a>
    );
  }
  if (href !== undefined && /^https?:/i.test(href)) {
    return (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  }
  return (
    <a {...rest} href={href}>
      {inner}
    </a>
  );
}

// Task-Listen bleiben lesend (`disabled` setzt remark-gfm); Codeblöcke mit `language-*` tauscht
// `Pre` gegen Highlighting (`CodeBlock`) oder Diagramm (`MermaidBlock`).
function Code({ node: _node, ...rest }: ComponentProps<'code'> & { node?: unknown }) {
  return <code {...rest} />;
}

function Pre({ node: _node, children, ...rest }: ComponentProps<'pre'> & { node?: unknown }) {
  const child = Children.toArray(children)[0];
  if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    const language = /(?:^|\s)language-(\S+)/.exec(child.props.className ?? '')?.[1];
    if (language !== undefined) {
      const code = String(child.props.children ?? '').replace(/\n$/, '');
      return language === 'mermaid' ? (
        <MermaidBlock source={code} />
      ) : (
        <CodeBlock code={code} language={language} />
      );
    }
  }
  return <pre {...rest}>{children}</pre>;
}

/**
 * Externe Bilder können den Leser verfolgen (ui.md §4.1). Ist der Schalter in Settings aus, steht
 * statt des Bilds ein Link darauf, in einem Link nur der Hinweis; Anhänge, `blob:`- und
 * `data:`-Bilder bleiben, denn sie verlassen den Rechner nicht.
 */
function Image({ node: _node, src, alt, ...rest }: ComponentProps<'img'> & { node?: unknown }) {
  const allowed = useExternalImages();
  const inLink = useContext(InLink);
  if (!allowed && typeof src === 'string' && /^https?:/i.test(src)) {
    const notice = (
      <>
        <ImageOff aria-hidden="true" className="inline size-4 align-text-bottom" />{' '}
        {alt === undefined || alt === '' ? m.imageBlockedNoAlt : m.imageBlocked(alt)}
      </>
    );
    return inLink ? (
      <span>{notice}</span>
    ) : (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {notice}
      </a>
    );
  }
  return <img {...rest} src={src} alt={alt} />;
}

const components: Components = { a: Anchor, code: Code, img: Image, pre: Pre };

const remarkPlugins = [remarkGfm, remarkGemoji];

export default memo(function Markdown({ source, backlog, issue, local, className }: MarkdownProps) {
  const store = useStore();
  const config = useSignal(store.config);
  const keys = useSignal(store.issues.keys);
  const prefix = config?.id_prefix;
  const attachments = issue?.attachments;
  const issueId = issue?.id;

  const rehypePlugins = useMemo((): NonNullable<Options['rehypePlugins']> => {
    const known = new Set(keys);
    const plugins: NonNullable<Options['rehypePlugins']> = [
      rehypeRaw,
      [rehypeSanitize, defaultSchema],
      rehypeStripSrcset,
    ];
    if (prefix !== undefined) {
      plugins.push([
        rehypeIssueLinks,
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
        prefix,
        issue:
          issueId === undefined || attachments === undefined
            ? undefined
            : { id: issueId, attachments },
        local,
      }),
    [backlog, prefix, issueId, attachments, local],
  );

  return (
    <div className={`markdown ${className ?? ''}`.trim()}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={urlTransform}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
