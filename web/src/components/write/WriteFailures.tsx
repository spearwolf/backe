import { XIcon } from 'lucide-react';
import { useSignal } from '../../data/use-signal.ts';
import type { Writes } from '../../data/writes.ts';
import { Button } from '../ui/button.tsx';
import { ErrorBox } from './ActionError.tsx';
import { m } from './write.messages.ts';

/** Fehler von Aktionen ohne eigene Fläche (Kontextmenü, Drag), je Eintrag zu schließen. */
export function WriteFailures({ writes }: { writes: Writes }) {
  const failures = useSignal(writes.failures);
  if (failures.length === 0) return null;
  return (
    <section aria-label={m.failures} className="space-y-2 border-b px-4 py-2">
      {failures.map(({ id, error }) => (
        <ErrorBox key={id} error={error} compact>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={m.dismiss}
            onClick={() => writes.dismiss(id)}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </ErrorBox>
      ))}
    </section>
  );
}
