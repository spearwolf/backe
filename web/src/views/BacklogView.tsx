import { m } from '../app/app.messages.ts';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';

/** Platzhalter; die Zahl der Issues zeigt, dass Patches live ankommen. */
export function BacklogView() {
  const store = useStore();
  const keys = useSignal(store.issues.keys);
  const loaded = useSignal(store.loaded);
  return (
    <section className="space-y-1 p-4">
      <h1 className="text-lg font-semibold">{m.tabBacklog}</h1>
      <p className="text-sm text-muted-foreground">
        {loaded ? m.issueCount(keys.length) : m.loading}
      </p>
    </section>
  );
}
