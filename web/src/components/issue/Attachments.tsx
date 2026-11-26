import type { AttachmentListJson } from '@backe/ui/api.ts';
import { Download, ExternalLink, File, FileText, Image as ImageIcon, Link } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type AttachmentKind, attachmentKind, extensionOf } from '../../app/attachment-kind.ts';
import { attachmentUrl } from '../../data/issue-api.ts';
import { formatBytes } from '../../lib/format.ts';
import { CodeBlock } from '../../markdown/CodeBlock.tsx';
import { Markdown } from '../../markdown/index.tsx';
import { languageOf } from '../../markdown/languages.ts';
import { m } from '../../views/issue.messages.ts';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx';

type Item = AttachmentListJson[number];
type MarkdownIssue = React.ComponentProps<typeof Markdown>['issue'];

const KIND_LABEL: Record<AttachmentKind, () => string> = {
  image: () => m.kindImage,
  markdown: () => m.kindMarkdown,
  text: () => m.kindText,
  download: () => m.kindDownload,
  url: () => m.kindUrl,
  'not-loaded': () => m.kindNotLoaded,
};

const KIND_ICON: Record<AttachmentKind, typeof File> = {
  image: ImageIcon,
  markdown: FileText,
  text: FileText,
  download: File,
  url: Link,
  'not-loaded': File,
};

/** Hostname einer Link-Anlage; eine kaputte URL zeigt sich unverändert. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Anhänge des Issues (ui.md §2.9.4): Name, Größe und Art je Eintrag, dazu Vorschau für Bilder,
 * Text und Markdown. Der Server liefert nur Bilder und gültiges UTF-8 bis `ATTACHMENT_TEXT_LIMIT`
 * als `text/plain` inline aus; alles andere wird heruntergeladen.
 */
export function Attachments(props: {
  attachments: AttachmentListJson;
  backlog: string;
  id: string;
  root: string | undefined;
  issue: MarkdownIssue;
}) {
  const { attachments, backlog, id, root, issue } = props;
  if (attachments.length === 0) return null;
  return (
    <section aria-labelledby="issue-attachments" className="space-y-2">
      <h2 id="issue-attachments" className="text-sm font-semibold">
        {m.attachments}
      </h2>
      <ul className="space-y-2">
        {attachments.map((a) => (
          <AttachmentItem
            key={a.name}
            item={a}
            backlog={backlog}
            id={id}
            root={root}
            issue={issue}
          />
        ))}
      </ul>
    </section>
  );
}

function AttachmentItem(props: {
  item: Item;
  backlog: string;
  id: string;
  root: string | undefined;
  issue: MarkdownIssue;
}) {
  const { item, backlog, id, root, issue } = props;
  const kind = attachmentKind(item);
  const href = attachmentUrl(backlog, id, item.name);
  const Icon = KIND_ICON[kind];
  // `text`/`markdown` fallen auf `download` zurück, sobald der Server keinen Text liefert.
  const [downgraded, setDowngraded] = useState(false);
  const shown = downgraded ? 'download' : kind;

  return (
    <li className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-mono">{item.name}</span>
        <span className="text-xs text-muted-foreground">{KIND_LABEL[shown]()}</span>
        {item.size !== undefined && (
          <span className="text-xs text-muted-foreground">{formatBytes(item.size)}</span>
        )}
        <span className="ml-auto">
          {item.url !== undefined ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              {hostOf(item.url)}
            </a>
          ) : (
            kind !== 'not-loaded' && (
              <a
                href={href}
                download={item.name}
                className="inline-flex items-center gap-1 underline underline-offset-2"
              >
                <Download className="size-3.5" aria-hidden="true" />
                {m.download}
                <span className="sr-only">{item.name}</span>
              </a>
            )
          )}
        </span>
      </div>
      {kind === 'not-loaded' && (
        <p className="text-xs text-muted-foreground">
          {m.lfsHint} <code className="font-mono">git -C {root ?? '.'} lfs pull</code>
        </p>
      )}
      {kind === 'image' && <ImagePreview name={item.name} src={href} />}
      {(kind === 'text' || kind === 'markdown') && (
        <TextPreview
          item={item}
          kind={kind}
          src={href}
          backlog={backlog}
          issue={issue}
          onNotText={() => setDowngraded(true)}
        />
      )}
    </li>
  );
}

function ImagePreview({ name, src }: { name: string; src: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={m.enlarge(name)}
        onClick={() => setOpen(true)}
        className="block rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <img
          src={src}
          alt={name}
          loading="lazy"
          className="max-h-48 max-w-full rounded-md border"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-[min(96vw,64rem)] sm:max-w-[min(96vw,64rem)]"
          closeLabel={m.closeDialog}
        >
          <DialogTitle className="font-mono text-sm">{name}</DialogTitle>
          <DialogDescription className="sr-only">{m.kindImage}</DialogDescription>
          <img src={src} alt={name} className="max-h-[80vh] max-w-full justify-self-center" />
        </DialogContent>
      </Dialog>
    </>
  );
}

type Loaded = { status: 'loading' } | { status: 'ready'; text: string };

function TextPreview(props: {
  item: Item;
  kind: 'text' | 'markdown';
  src: string;
  backlog: string;
  issue: MarkdownIssue;
  onNotText: () => void;
}) {
  const { item, kind, src, backlog, issue, onNotText } = props;
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `onNotText` ist ein frischer Setter-Aufruf je Render; geladen wird nur bei neuer URL.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(src);
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.toLowerCase().startsWith('text/plain')) {
        if (!cancelled) onNotText();
        return;
      }
      const text = await res.text();
      if (!cancelled) setLoaded({ status: 'ready', text });
    })().catch(() => {
      if (!cancelled) onNotText();
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (loaded.status === 'loading') {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {m.previewLoading}
      </p>
    );
  }
  return (
    <details open>
      <summary className="cursor-pointer rounded-sm text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        {m.preview}
      </summary>
      {kind === 'markdown' ? (
        <Markdown source={loaded.text} backlog={backlog} issue={issue} />
      ) : (
        <CodeBlock code={loaded.text} language={languageOf(extensionOf(item.name)) ?? undefined} />
      )}
    </details>
  );
}
