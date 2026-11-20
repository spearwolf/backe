/**
 * Lokaler Zustand des Syncs unter `.git/backe` (backe.md §2.16.2, §2.16.4): die Konfliktablage
 * `conflicts/<id>.json` und `sync.json` mit Zeit und Fehler der letzten Runde. Beides wird atomar
 * geschrieben; was sich nicht lesen lässt, gilt als nicht vorhanden. Dazu die Dateien des
 * Hintergrund-Syncs: `sync.lock`, das Dirty-Flag `sync.dirty` und das Log `sync.log`.
 */
import { renameSync, statSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { BackeError } from '../core/errors.ts';
import { stateDir } from '../git/local-state.ts';
import { decodeOp, encodeOp, type Operation } from '../ops/operation.ts';
import { writeFileAtomic } from '../store/files.ts';

export type ConflictUnit = {
  sha: string;
  subject: string;
  kind: 'op' | 'batch' | 'manual';
  ops: Operation[];
  /**
   * Herkunft des Inhalts je `attach.add` mit Datei (Index in `ops` → `<sha>:<pfad>`); der Pfad
   * entsteht aus der ursprünglichen ID, auch wenn `ops` eine umgeschriebene nennt.
   */
  sources?: Record<number, string>;
};

/** Eintrag der Konfliktablage; `units[0]` ist die gescheiterte Einheit, danach die Folgeeinheiten. */
export type ConflictEntry = {
  version: 1;
  id: string;
  created: string;
  onto: string;
  reason: { code: string; message: string; reason?: string; ids?: string[] };
  units: ConflictUnit[];
};

export type SyncState = {
  last_attempt?: string;
  last_success?: string;
  last_error?: { code: string; message: string; at: string; paths?: string[]; commit?: string };
};

/** `<YYYYMMDDTHHMMSSZ>-<6 hex>`; nur solche IDs werden zu Dateinamen. */
export const CONFLICT_ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{6}$/;

const StoredEntry = z.object({
  version: z.literal(1),
  id: z.string().regex(CONFLICT_ID_RE),
  created: z.string(),
  onto: z.string(),
  reason: z.object({
    code: z.string(),
    message: z.string(),
    reason: z.string().optional(),
    ids: z.array(z.string()).optional(),
  }),
  units: z.array(
    z.object({
      sha: z.string(),
      subject: z.string(),
      kind: z.enum(['op', 'batch', 'manual']),
      ops: z.array(z.unknown()),
      sources: z.record(z.string().regex(/^\d+$/), z.string()).optional(),
    }),
  ),
});

const StoredSyncState = z.object({
  version: z.literal(1),
  last_attempt: z.string().optional(),
  last_success: z.string().optional(),
  last_error: z
    .object({
      code: z.string(),
      message: z.string(),
      at: z.string(),
      paths: z.array(z.string()).optional(),
      commit: z.string().optional(),
    })
    .optional(),
});

export type SyncFile = 'sync.json' | 'sync.lock' | 'sync.dirty' | 'sync.log';

/** Pfad einer Sync-Datei der Arbeitskopie. */
export async function syncFile(wc: string, name: SyncFile): Promise<string> {
  return join(await stateDir(wc), name);
}

/** Ein Log über dieser Größe wird beim Start eines Hintergrund-Syncs nach `<log>.1` verschoben. */
export const SYNC_LOG_MAX_BYTES = 1024 * 1024;

/**
 * Verschiebt `log` nach `<log>.1` (ein älteres `.1` wird ersetzt), wenn es größer als
 * `SYNC_LOG_MAX_BYTES` ist. Synchron, weil der Start des Hintergrund-Prozesses es vor dem Öffnen
 * seines Log-Deskriptors braucht.
 */
export function rotateSyncLog(log: string): void {
  let size: number;
  try {
    size = statSync(log).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  if (size > SYNC_LOG_MAX_BYTES) renameSync(log, `${log}.1`);
}

/** Hängt eine Zeile `<at> <code>: <message>` an `log` an. */
export async function appendSyncLog(
  log: string,
  at: string,
  code: string,
  message: string,
): Promise<void> {
  await appendFile(log, `${at} ${code}: ${message}\n`);
}

async function conflictsDir(wc: string): Promise<string> {
  return join(await stateDir(wc), 'conflicts');
}

/** Eine Operation, wie sie im Trailer stünde: ohne den Inhalt eines Anhangs. */
const plainOp = (op: Operation): unknown => JSON.parse(encodeOp(op));

/** Legt die Einträge ab, je Eintrag eine Datei `<id>.json`. */
export async function writeConflicts(wc: string, entries: readonly ConflictEntry[]): Promise<void> {
  const dir = await conflictsDir(wc);
  await mkdir(dir, { recursive: true });
  for (const entry of entries) {
    if (!CONFLICT_ID_RE.test(entry.id)) {
      throw new BackeError('unexpected', `Ungültige Konflikt-ID »${entry.id}«`);
    }
    const stored = {
      ...entry,
      units: entry.units.map((u) => ({ ...u, ops: u.ops.map(plainOp) })),
    };
    await writeFileAtomic(join(dir, `${entry.id}.json`), `${JSON.stringify(stored, null, 2)}\n`);
  }
}

/** Liest einen Eintrag; was sich nicht als Eintrag lesen lässt, ist `undefined`. */
function parseEntry(text: string, id: string): ConflictEntry | undefined {
  try {
    const parsed = StoredEntry.safeParse(JSON.parse(text));
    if (!parsed.success || parsed.data.id !== id) return undefined;
    const units = parsed.data.units.map((u) => ({
      ...u,
      ops: u.ops.map((op) => decodeOp(JSON.stringify(op))),
    }));
    return { ...parsed.data, units };
  } catch {
    return undefined;
  }
}

/** Alle lesbaren Einträge der Konfliktablage, nach `id` sortiert. */
export async function listConflicts(wc: string): Promise<ConflictEntry[]> {
  const dir = await conflictsDir(wc);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: ConflictEntry[] = [];
  for (const name of names.sort()) {
    const id = name.slice(0, -'.json'.length);
    if (!name.endsWith('.json') || !CONFLICT_ID_RE.test(id)) continue;
    const entry = parseEntry(await readFile(join(dir, name), 'utf8'), id);
    if (entry !== undefined) out.push(entry);
  }
  return out;
}

/** Entfernt einen Eintrag; einen unbekannten gibt es nicht (`not_found`). */
export async function removeConflict(wc: string, id: string): Promise<void> {
  const missing = () => new BackeError('not_found', `Konflikt ${id} nicht gefunden`);
  if (!CONFLICT_ID_RE.test(id)) throw missing();
  const file = join(await conflictsDir(wc), `${id}.json`);
  try {
    await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw missing();
    throw err;
  }
  await rm(file, { force: true });
}

/** `sync.json`; fehlend oder kaputt → leer. */
export async function readSyncState(wc: string): Promise<SyncState> {
  let text: string;
  try {
    text = await readFile(await syncFile(wc, 'sync.json'), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  try {
    const parsed = StoredSyncState.safeParse(JSON.parse(text));
    if (!parsed.success) return {};
    const { version: _, ...state } = parsed.data;
    return state;
  } catch {
    return {};
  }
}

export async function writeSyncState(wc: string, s: SyncState): Promise<void> {
  const file = await syncFile(wc, 'sync.json');
  await writeFileAtomic(file, `${JSON.stringify({ version: 1, ...s })}\n`);
}
