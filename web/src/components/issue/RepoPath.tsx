import { useState } from 'react';
import { useWrites } from '../../data/write-context.tsx';
import { m } from '../../views/issue.messages.ts';
import { Button } from '../ui/button.tsx';
import { ErrorBox } from '../write/ActionError.tsx';
import { useAction } from '../write/use-action.ts';
import { useFocusReturn } from './edit/use-focus-return.ts';
import { CopyValue } from './parts.tsx';

/**
 * Lokaler Pfad eines Repos auf Abruf (`repo_locate`, ui.md §2.9.1). Das Tool verlangt Schreibrecht
 * (ui.md §2.3.2): Den Knopf setzt nur ein, wer `canWrite` hat.
 */
export function RepoPath({ name }: { name: string }) {
  const { writes } = useWrites();
  const { busy, error, run } = useAction();
  const [path, setPath] = useState<string>();
  // Nach dem Erfolg ersetzt der Pfad den Knopf; der Fokus geht an »Pfad kopieren«.
  const { scope, capture } = useFocusReturn<HTMLDivElement>(busy);
  return (
    <div ref={scope} className="space-y-1">
      {path === undefined ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          aria-label={m.localPathOf(name)}
          disabled={busy}
          onClick={() => {
            capture();
            void run(async () => setPath((await writes.run('repo_locate', { name })).path));
          }}
        >
          {m.localPath}
        </Button>
      ) : (
        <CopyValue value={path} label={m.copyPath} />
      )}
      {error !== undefined && <ErrorBox error={error} compact />}
    </div>
  );
}
