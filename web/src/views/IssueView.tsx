import { m } from '../app/app.messages.ts';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';

/** Platzhalter bis zur Issue-Ansicht: ID und Titel, nach dem Löschen die Marke. */
export function IssueView({ id }: { id: string }) {
  const store = useStore();
  const issue = useSignal(store.issues.get(id));
  const loaded = useSignal(store.loaded);
  return (
    <section className="p-4">
      <h1 className="flex items-baseline gap-2 text-lg font-semibold">
        <span className="font-mono">{id}</span>
        {issue !== undefined && <span>{issue.title}</span>}
        {loaded && issue === undefined && <span className="italic">{m.deleted}</span>}
      </h1>
    </section>
  );
}
