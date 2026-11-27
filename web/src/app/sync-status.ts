/**
 * Das JSON von `sync status` (backe.md §2.16.2) und das Ergebnis von `sync_now` für die Anzeige in
 * Settings. Der Status steht untypisiert im Store; was dort nicht passt, zählt als nicht gesetzt,
 * wie in `sync-display.ts`.
 */
import { shortSha } from '@backe/core/ids.ts';
import type { SyncResultJson } from '@backe/ui/api.ts';

export type SyncConflict = { id: string; created: string | null; subject: string; reason: string };

export type SyncStatusView = {
  remote: string | null;
  mode: string;
  unpushed: number;
  lastAttempt: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  running: boolean;
  conflicts: SyncConflict[];
};

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// `last_error` und `reason` sind Objekte mit `message`; ein bloßer Text gilt auch.
const messageOf = (v: unknown): string | null => (isRecord(v) ? str(v.message) : str(v));

function conflictOf(v: unknown): SyncConflict | undefined {
  if (!isRecord(v) || typeof v.id !== 'string') return undefined;
  return {
    id: v.id,
    created: str(v.created),
    subject: str(v.subject) ?? '',
    reason: messageOf(v.reason) ?? '',
  };
}

export function syncStatusView(sync: Record<string, unknown>): SyncStatusView {
  const conflicts = Array.isArray(sync.conflicts) ? sync.conflicts : [];
  return {
    remote: str(sync.remote),
    mode: str(sync.mode) ?? '',
    unpushed: typeof sync.unpushed === 'number' ? sync.unpushed : 0,
    lastAttempt: str(sync.last_attempt),
    lastSuccess: str(sync.last_success),
    lastError: messageOf(sync.last_error),
    running: sync.running === true,
    conflicts: conflicts.map(conflictOf).filter((c) => c !== undefined),
  };
}

export type SyncOutcomeView =
  | { skipped: true; notices: string[] }
  | { skipped: false; fetched: number; replayed: number; pushed: string | null; notices: string[] };

/**
 * Ergebnis einer Runde `sync_now` zum Anzeigen; anders als der Status ist es typisiert
 * (`SyncResultJson`). Den gepushten Commit zeigt die UI wie das CLI gekürzt.
 */
export function syncOutcomeView(r: SyncResultJson): SyncOutcomeView {
  const notices = (r.notices ?? []).map((n) => n.message);
  if (r.skipped === 'no_remote') return { skipped: true, notices };
  return {
    skipped: false,
    fetched: r.fetched,
    replayed: r.replayed,
    pushed: r.pushed === null ? null : shortSha(r.pushed),
    notices,
  };
}
