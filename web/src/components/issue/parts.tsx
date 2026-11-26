import { Check, Copy } from 'lucide-react';
import { type ReactNode, type Ref, useEffect, useState } from 'react';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { formatDate } from '../../lib/format.ts';
import { m } from '../../views/issue.messages.ts';
import { Button } from '../ui/button.tsx';

/** Zeitpunkt als `<time>` in der Locale der Oberfläche. */
export function Time({ iso }: { iso: string }) {
  return <time dateTime={iso}>{formatDate(iso)}</time>;
}

/** Handle roh; der Name aus dem Store steht im `title`. */
export function Author({ handle }: { handle: string }) {
  const store = useStore();
  const user = useSignal(store.users.get(handle));
  return <span title={user?.name}>{handle}</span>;
}

/** Wert in Monospace mit Kopier-Knopf (ID, Pfad); die Bestätigung steht in einer Live-Region. */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied && !failed) return;
    const timer = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [copied, failed]);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-xs">{value}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label={label}
        onClick={() => {
          navigator.clipboard.writeText(value).then(
            () => setCopied(true),
            () => setFailed(true),
          );
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
      <span role="status" className="text-xs text-muted-foreground">
        {copied ? m.copied : failed ? m.copyFailed : ''}
      </span>
    </span>
  );
}

/**
 * Eine Gruppe der rechten Spalte (`blocked_by`, `depends_on`, …); `footer` steht unter der Liste.
 * `ref` reicht an die `section` durch, etwa als Fokusbereich eines Editors.
 */
export function RelationGroup(props: {
  title: string;
  note?: string;
  children: ReactNode;
  footer?: ReactNode;
  ref?: Ref<HTMLElement>;
}) {
  return (
    <section ref={props.ref} aria-label={props.title} className="space-y-1">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        {props.title}
        {props.note !== undefined && (
          <span className="text-xs font-normal tabular-nums text-muted-foreground">
            {props.note}
          </span>
        )}
      </h2>
      <ul className="space-y-1">{props.children}</ul>
      {props.footer}
    </section>
  );
}
