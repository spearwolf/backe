import { CircleAlert, XIcon } from 'lucide-react';
import { useSignal } from '../../data/use-signal.ts';
import type { Writes } from '../../data/writes.ts';
import { Button } from '../ui/button.tsx';
import { m } from './write.messages.ts';

/** Fehler von Aktionen ohne eigene Fläche (Kontextmenü, Drag), je Eintrag zu schließen. */
export function WriteFailures({ writes }: { writes: Writes }) {
  const failures = useSignal(writes.failures);
  if (failures.length === 0) return null;
  return (
    <div className="space-y-2 border-b px-4 py-2">
      {failures.map(({ id, error }) => (
        <div
          key={id}
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/50 p-2 text-sm"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="flex-1 space-y-1">
            <p>{error.message}</p>
            {error.hint !== undefined && <p className="text-muted-foreground">{error.hint}</p>}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={m.dismiss}
            onClick={() => writes.dismiss(id)}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      ))}
    </div>
  );
}
