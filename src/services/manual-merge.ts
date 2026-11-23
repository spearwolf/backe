/**
 * Dreiwege-Übernahme eines `manual`-Commits im Replay (backe.md §2.16.2): je Pfad, den der Commit
 * ändert, gegen den aktuellen Stand; Textkonflikte entscheidet ein Resolver oder sie brechen ab.
 */
import { BackeError } from '../core/errors.ts';
import { readBlobs, treeChanges } from '../git/history.ts';
import { mergeText } from '../git/merge-file.ts';
import type { FileChange } from '../store/files.ts';
import { m } from './manual-merge.messages.ts';

/** Konfliktpfad eines `manual`-Commits; `ours` ist der aktuelle Stand (Remote), `theirs` lokal. */
export type ManualConflictPath = {
  path: string;
  base: Buffer | null;
  ours: Buffer | null;
  theirs: Buffer | null;
  /** Ergebnis von `git merge-file` mit Markern, wenn beide Seiten Text sind. */
  merged?: Buffer;
};

/**
 * Entscheidet einen Textkonflikt eines `manual`-Commits: `edit` liefert den Endinhalt je
 * Konfliktpfad (ein fehlender Pfad bleibt wie im Remote), `local` nimmt die lokale Seite,
 * `remote` lässt den ganzen Commit weg, `abort` bricht die Runde ab.
 */
export type ManualResolver = (c: {
  sha: string;
  subject: string;
  paths: ManualConflictPath[];
}) => Promise<
  | { kind: 'edit'; files: Map<string, Buffer> }
  | { kind: 'local' }
  | { kind: 'remote' }
  | { kind: 'abort' }
>;

const same = (a: Buffer | null, b: Buffer | null) =>
  a === null || b === null ? a === b : a.equals(b);
const isText = (b: Buffer | null) => b === null || !b.includes(0);

function manualConflict(sha: string, paths: readonly string[]): BackeError {
  return new BackeError('conflict', m.textConflict(sha.slice(0, 7), paths.join(', ')), {
    hint: 'backe sync --interactive',
    details: { commit: sha, paths },
  });
}

/**
 * Die Änderungen eines `manual`-Commits auf dem aktuellen Stand `head` (backe.md §2.16.2): je Pfad
 * `basis` = `parent`, `lokal` = Ursprungs-Commit, `aktuell` = `head`. Was sich nicht sauber
 * übernehmen lässt, entscheidet `resolve`; ohne ihn bricht die Runde mit `conflict` ab. Wählt er
 * `remote`, fällt der ganze Commit weg (leere Liste).
 */
export async function manualChanges(
  wc: string,
  unit: { sha: string; subject: string; parent: string | undefined },
  head: string,
  resolve: ManualResolver | undefined,
): Promise<FileChange[]> {
  const { parent } = unit;
  const paths = (await treeChanges(wc, parent, unit.sha)).map((c) => c.path);
  const blobs = await readBlobs(
    wc,
    paths.flatMap((p) => [
      ...(parent === undefined ? [] : [`${parent}:${p}`]),
      `${unit.sha}:${p}`,
      `${head}:${p}`,
    ]),
  );
  const changes: FileChange[] = [];
  const conflicts: ManualConflictPath[] = [];
  for (const path of paths) {
    const base = parent === undefined ? null : (blobs.get(`${parent}:${path}`) ?? null);
    const theirs = blobs.get(`${unit.sha}:${path}`) ?? null;
    const ours = blobs.get(`${head}:${path}`) ?? null;
    if (same(theirs, ours)) continue;
    if (same(ours, base)) {
      changes.push({ path, content: theirs });
      continue;
    }
    if (same(theirs, base)) continue;
    if (ours === null || theirs === null || ![base, ours, theirs].every(isText)) {
      conflicts.push({ path, base, ours, theirs });
      continue;
    }
    const merged = await mergeText(wc, {
      base: base ?? Buffer.alloc(0),
      ours,
      theirs,
      labels: ['remote', 'basis', 'lokal'],
    });
    if (!merged.clean) conflicts.push({ path, base, ours, theirs, merged: merged.content });
    else if (!merged.content.equals(ours)) changes.push({ path, content: merged.content });
  }
  if (conflicts.length === 0) return changes;
  const abort = () =>
    manualConflict(
      unit.sha,
      conflicts.map((c) => c.path),
    );
  const decision =
    resolve === undefined
      ? { kind: 'abort' as const }
      : await resolve({ sha: unit.sha, subject: unit.subject, paths: conflicts });
  if (decision.kind === 'abort') throw abort();
  if (decision.kind === 'remote') return [];
  for (const c of conflicts) {
    const content = decision.kind === 'local' ? c.theirs : (decision.files.get(c.path) ?? c.ours);
    if (!same(content, c.ours)) changes.push({ path: c.path, content });
  }
  return changes;
}
