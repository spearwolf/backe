import { LoaderCircle } from 'lucide-react';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { m } from './write.messages.ts';

/** Zeigt, dass für das Issue eine optimistische Überlagerung offen ist; sonst nichts. */
export function PendingMark({ id }: { id: string }) {
  const pending = useSignal(useStore().pendingCount(id));
  if (pending === 0) return null;
  return (
    <span className="inline-flex items-center">
      <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{m.pending}</span>
    </span>
  );
}
