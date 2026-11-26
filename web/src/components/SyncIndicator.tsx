import { CircleCheck, CloudUpload, type LucideIcon, TriangleAlert, WifiOff } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { m } from '../app/app.messages.ts';
import { syncDisplay } from '../app/sync-display.ts';
import type { Session } from '../data/session.ts';
import { useSignal } from '../data/use-signal.ts';

/** Sync-Zustand der Kopfzeile: Icon und Text wie die CLI-Kopfzeile, nie nur Farbe. */
export function SyncIndicator({ session }: { session: Session }) {
  const sync = useSignal(session.store.sync);
  const status = useSignal(session.status);
  const display = syncDisplay(sync, status);
  if (display.kind === 'none') return null;

  let Icon: LucideIcon = CircleCheck;
  const parts: ReactNode[] = [];
  if (display.kind === 'offline') {
    Icon = WifiOff;
    parts.push(m.syncOffline);
  } else if (display.kind === 'ok') {
    parts.push(m.syncUpToDate);
  } else {
    const { unpushed, conflicts, failed } = display;
    Icon = conflicts !== undefined || failed !== undefined ? TriangleAlert : CloudUpload;
    if (unpushed !== undefined) parts.push(m.syncUnpushed(unpushed));
    if (conflicts !== undefined) parts.push(m.syncConflicts(conflicts));
    if (failed !== undefined) parts.push(<span title={failed}>{m.syncFailed}</span>);
  }

  return (
    <span role="status" className="flex items-center gap-1.5 text-sm whitespace-nowrap">
      <Icon className="size-4" aria-hidden="true" />
      <span>
        {parts.map((part, i) => (
          // Die Teile stehen in fester Reihenfolge; der Index ist ein stabiler Key.
          // biome-ignore lint/suspicious/noArrayIndexKey: feste Reihenfolge, nie umsortiert
          <Fragment key={i}>
            {i > 0 && ' · '}
            {part}
          </Fragment>
        ))}
      </span>
    </span>
  );
}
