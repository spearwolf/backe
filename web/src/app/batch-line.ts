/**
 * Fehler aus einem `batch`, den das Board selbst schickt (Bahn und Spalte zugleich, ui.md §2.8).
 * BK stellt jeder Meldung aus einem Batch die Zeile der Operation voran (`Zeile 2: …`, `onLine`
 * in `src/ops/batch.ts`). Wer eine Karte zieht, hat keinen Batch geschrieben; die Zeile sagt ihm
 * nichts. Sonst bleiben Meldung und Hinweis wörtlich (ui.md §2.14).
 */
import { m } from '@backe/ops/batch.messages.ts';
import { ApiError } from '../data/api-client.ts';

const lineOf = (details: unknown): number | undefined => {
  const line = (details as { line?: unknown } | null | undefined)?.line;
  return typeof line === 'number' ? line : undefined;
};

/**
 * `err` ohne das Zeilenpräfix, gerechnet mit derselben Meldung wie der Server und mit
 * `details.line`. Die Oberfläche spricht die Sprache des Servers (`setLocale(lang)` beim Start);
 * passt das Präfix trotzdem nicht, bleibt `err` unverändert, dasselbe Objekt.
 */
export function withoutBatchLine(err: ApiError): ApiError {
  const line = lineOf(err.details);
  if (line === undefined) return err;
  const prefix = m.lineError(line, '');
  if (!err.message.startsWith(prefix)) return err;
  return new ApiError(
    err.status,
    err.code,
    err.message.slice(prefix.length),
    err.hint,
    err.details,
  );
}
