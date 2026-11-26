import { type SyncLineInput, syncLineParts } from '@backe/core/sync-line.ts';
import type { ConnectionStatus } from '../data/connection.ts';

export type SyncDisplay =
  | { kind: 'none' }
  | { kind: 'offline' }
  | { kind: 'ok' }
  | { kind: 'open'; unpushed?: number; conflicts?: number; failed?: string };

function lastError(v: unknown): { message: string } | null {
  if (typeof v !== 'object' || v === null) return null;
  const message = (v as { message?: unknown }).message;
  return typeof message === 'string' ? { message } : null;
}

/** Das JSON von `sync status` kommt ungeprüft über die Leitung; was nicht passt, zählt nicht. */
function lineInput(sync: Record<string, unknown>): SyncLineInput {
  return {
    remote: typeof sync.remote === 'string' ? sync.remote : null,
    mode: typeof sync.mode === 'string' ? sync.mode : '',
    unpushed: typeof sync.unpushed === 'number' ? sync.unpushed : 0,
    last_error: lastError(sync.last_error),
    conflicts: Array.isArray(sync.conflicts) ? sync.conflicts : [],
  };
}

/**
 * Was die Sync-Anzeige der Kopfzeile zeigt, nach derselben Regel wie die CLI-Kopfzeile. Ohne
 * Verbindung gilt `offline` vor allem anderen, auch ohne Arbeitskopie: dann ist alles Gezeigte
 * womöglich veraltet. Ohne Arbeitskopie (`sync: null`) sonst keine Anzeige.
 */
export function syncDisplay(
  sync: Record<string, unknown> | null,
  status: ConnectionStatus,
): SyncDisplay {
  if (status === 'offline') return { kind: 'offline' };
  if (sync === null) return { kind: 'none' };
  const parts = syncLineParts(lineInput(sync));
  if (Object.keys(parts).length === 0) return { kind: 'ok' };
  return { kind: 'open', ...parts };
}
