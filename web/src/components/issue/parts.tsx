import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { formatDate } from '../../lib/format.ts';

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
