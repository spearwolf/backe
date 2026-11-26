/**
 * Die Regel der Sync-Kopfzeile (backe.md §2.16.2) als reines Modul: die CLI formatiert die Teile
 * (`statusLine`), der Browser-Client zeigt dieselben Zustände. Die Eingabe passt auf das JSON von
 * `sync status` (`remote: null` ohne Remote) wie auf den internen `SyncStatus`.
 */
export type SyncLineInput = {
  remote: string | null | undefined;
  mode: string;
  unpushed: number;
  last_error?: { message: string } | null;
  conflicts: readonly unknown[];
};

/** Offene Teile; ein leeres Objekt heißt: nichts offen. */
export type SyncLineParts = { unpushed?: number; conflicts?: number; failed?: string };

/**
 * Ungepushtes zählt nur mit Remote und nur, wenn die letzte Runde fehlschlug oder der Modus
 * `manual` ist; Konflikte ab einem, `failed` ist die Meldung des letzten Fehlers.
 */
export function syncLineParts(s: SyncLineInput): SyncLineParts {
  const parts: SyncLineParts = {};
  const error = s.last_error ?? undefined;
  if (s.remote != null && s.unpushed > 0 && (error !== undefined || s.mode === 'manual')) {
    parts.unpushed = s.unpushed;
  }
  if (s.conflicts.length > 0) parts.conflicts = s.conflicts.length;
  if (error !== undefined) parts.failed = error.message;
  return parts;
}
