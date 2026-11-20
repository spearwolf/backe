/**
 * `backe sync [--background] [--interactive]`, `sync status` und `sync resolve [<id>]
 * [--drop | --apply]` (backe.md §2.16.2, §2.16.4).
 */
import { rm } from 'node:fs/promises';
import { extname } from 'node:path';
import type { Command } from 'commander';
import { requireWriter } from '../../context/resolve.ts';
import { BackeError } from '../../core/errors.ts';
import { summarizeBatch, summarizeOp } from '../../ops/operation.ts';
import { runBackground, type SyncStatus, syncStatus } from '../../services/background.ts';
import type { ManualConflictPath, ManualResolver } from '../../services/replay.ts';
import { resolveConflict } from '../../services/resolve.ts';
import { type SyncOutcome, syncNow } from '../../services/sync.ts';
import { type ConflictEntry, listConflicts } from '../../services/sync-state.ts';
import { editorCommand, editText } from '../editor.ts';
import { action, type CommandEnv, emit, type Runtime, subcommand } from '../options.ts';
import { json, lines, renderError, renderHints, safeText } from '../output.ts';

const short = (sha: string) => sha.slice(0, 7);

/** Die Subjects der Konflikt-Einträge: das der gescheiterten Einheit. */
const subjectOf = (e: ConflictEntry): string => e.units[0]?.subject ?? '';

/** `<id>  <subject>  <reason.message>` je Konflikt, wie `sync status` und `sync resolve` ihn zeigen. */
const conflictLines = (conflicts: readonly ConflictEntry[]): string[] =>
  conflicts.map((c) => safeText(`${c.id}  ${subjectOf(c)}  ${c.reason.message}`));

const conflictJson = (c: ConflictEntry) => ({
  id: c.id,
  created: c.created,
  subject: subjectOf(c),
  reason: c.reason,
});

/**
 * Ergebnis einer Runde als Text: `kein Remote`, `aktuell` oder je Schritt eine Zeile
 * (`fetch: <n> neue Commits`, `replay: <n> Einheiten neu signiert`, `konflikt: <id>  <subject>`,
 * `push: <sha7>`).
 */
function syncText(out: SyncOutcome, entries: readonly ConflictEntry[]): string {
  if (out.skipped !== undefined) return 'kein Remote\n';
  const subjects = new Map(entries.map((e) => [e.id, subjectOf(e)]));
  const rows: string[] = [];
  if (out.fetched > 0) rows.push(`fetch: ${out.fetched} neue Commits`);
  if (out.replayed > 0) rows.push(`replay: ${out.replayed} Einheiten neu signiert`);
  for (const id of out.conflicts) rows.push(`konflikt: ${id}  ${subjects.get(id) ?? ''}`);
  if (out.pushed !== undefined) rows.push(`push: ${short(out.pushed)}`);
  return rows.length === 0 ? 'aktuell\n' : lines(rows.map(safeText));
}

const syncJson = (out: SyncOutcome) => ({
  fetched: out.fetched,
  replayed: out.replayed,
  conflicts: out.conflicts,
  pushed: out.pushed ?? null,
  rounds: out.rounds,
  skipped: out.skipped,
  notices: out.notices.length === 0 ? undefined : out.notices,
});

/** Eine Zeile, die mit einem Konfliktmarker beginnt. */
const MARKER = /^(<<<<<<< |=======|>>>>>>> )/m;

/**
 * `e` bei einem Textkonflikt: je Konfliktpfad mit Markern der Text in den Editor; der Inhalt danach
 * darf keine Marker mehr tragen. Pfade ohne Text mit Markern (Binär, Löschen gegen Ändern) bleiben
 * wie im Remote. Ein Rest von Markern heißt: noch einmal fragen (`undefined`).
 */
async function editConflicts(
  env: CommandEnv,
  sha: string,
  paths: readonly ManualConflictPath[],
): Promise<Map<string, Buffer> | undefined> {
  const files = new Map<string, Buffer>();
  for (const c of paths) {
    if (c.merged === undefined) {
      env.io.stderr(
        renderHints([`${c.path} lässt sich nicht im Editor lösen; bleibt wie im Remote`]),
      );
      continue;
    }
    const ext = extname(c.path).slice(1) || 'txt';
    const edited = await editText(env.io, `sync-${short(sha)}`, c.merged.toString('utf8'), ext);
    await rm(edited.file, { force: true });
    if (MARKER.test(edited.text)) {
      env.io.stderr(renderHints([`${c.path} hat noch Konfliktmarker`]));
      return undefined;
    }
    files.set(c.path, Buffer.from(edited.text, 'utf8'));
  }
  return files;
}

/**
 * Der Resolver von `sync --interactive` (backe.md §2.16.2): je `manual`-Textkonflikt
 * `[e]ditieren, [l]okal nehmen, [r]emote behalten, [a]bbrechen`, bis eine gültige Antwort kommt.
 */
function interactiveResolver(env: CommandEnv): ManualResolver {
  return async ({ sha, subject, paths }) => {
    env.io.stderr(
      lines([
        safeText(
          `Textkonflikt in manual-Commit ${short(sha)} (${subject}): ${paths.map((p) => p.path).join(', ')}`,
        ),
      ]),
    );
    for (;;) {
      const answer = (
        await env.io.ask('[e]ditieren, [l]okal nehmen, [r]emote behalten, [a]bbrechen? ')
      )
        .trim()
        .toLowerCase();
      if (answer === 'l') return { kind: 'local' };
      if (answer === 'r') return { kind: 'remote' };
      if (answer === 'a') return { kind: 'abort' };
      if (answer !== 'e') continue;
      if (editorCommand(env.io) === undefined) {
        env.io.stderr(renderHints(['Kein Editor verfügbar (BACKE_EDITOR, VISUAL oder EDITOR)']));
        continue;
      }
      const files = await editConflicts(env, sha, paths);
      if (files !== undefined) return { kind: 'edit', files };
    }
  };
}

type SyncOpts = { background?: boolean; interactive?: boolean };

/**
 * `sync --background`: eine Runde samt Debounce, nichts nach stdout, Exit immer 0. stderr geht beim
 * Start nach Writes und Reads ins Log; dort landet auch ein Kontext, der sich nicht auflösen lässt.
 */
async function background(env: CommandEnv): Promise<void> {
  try {
    await runBackground(await env.context());
  } catch (err) {
    env.io.stderr(renderError(err, 'text'));
  }
}

function statusText(s: SyncStatus): string {
  const rows = [
    `remote  ${s.remote ?? 'kein Remote'}`,
    `modus  ${s.mode}`,
    `ungepusht  ${s.unpushed}`,
    `letzter Sync  ${s.state.last_attempt ?? 'nie'}`,
  ];
  if (s.state.last_error !== undefined) rows.push(`fehler  ${s.state.last_error.message}`);
  if (s.running) rows.push('läuft  ja');
  return lines([...rows.map(safeText), ...conflictLines(s.conflicts)]);
}

const statusJson = (s: SyncStatus) => ({
  remote: s.remote ?? null,
  mode: s.mode,
  unpushed: s.unpushed,
  last_attempt: s.state.last_attempt,
  last_success: s.state.last_success,
  last_error: s.state.last_error,
  running: s.running,
  conflicts: s.conflicts.map(conflictJson),
});

type ResolveOpts = { drop?: boolean; apply?: boolean };

async function resolve(env: CommandEnv, id: string | undefined, opts: ResolveOpts): Promise<void> {
  const ctx = await env.context();
  if (id === undefined) {
    if (opts.drop === true || opts.apply === true) {
      throw new BackeError('usage', '--drop und --apply brauchen eine Konflikt-ID', {
        hint: 'backe sync resolve zeigt die Liste',
      });
    }
    const { conflicts } = await syncStatus(ctx);
    emit(env, { conflicts: conflicts.map(conflictJson) }, () => lines(conflictLines(conflicts)));
    return;
  }
  if ((opts.drop === true) === (opts.apply === true)) {
    throw new BackeError('usage', 'Genau eins von --drop und --apply angeben', {
      hint: `backe sync resolve ${id} --drop oder --apply`,
    });
  }
  const how = opts.drop === true ? 'drop' : 'apply';
  const r = await resolveConflict(ctx, id, how);
  env.committed(r.commit);
  emit(env, { id, action: how, commit: r.commit ?? null, ops: r.ops }, () => {
    if (how === 'drop') return `verworfen: ${safeText(id)}\n`;
    const [only] = r.ops;
    const summary =
      r.ops.length === 1 && only !== undefined ? summarizeOp(only) : summarizeBatch(r.ops);
    return `${r.commit === undefined ? 'unverändert: ' : ''}${safeText(summary)}\n`;
  });
}

export function syncCommands(program: Command, rt: Runtime): void {
  const sync = subcommand(program, 'sync', 'mit dem Remote synchronisieren (eine Runde)')
    .option('--background', 'als Hintergrund-Sync: Debounce, keine Ausgabe, Exit immer 0')
    .option('--interactive', 'Textkonflikte in manual-Commits einzeln entscheiden')
    .action(
      action(
        rt,
        async (env, opts: SyncOpts) => {
          if (opts.background === true) {
            if (opts.interactive !== true) return background(env);
            throw new BackeError('usage', '--background und --interactive schließen sich aus');
          }
          if (opts.interactive === true && !(env.io.stdinIsTTY && env.io.isTTY)) {
            throw new BackeError('usage', '--interactive braucht ein Terminal');
          }
          const ctx = await env.context();
          const out = await syncNow(
            ctx,
            opts.interactive === true ? { resolveManual: interactiveResolver(env) } : {},
          );
          if (env.format === 'json') {
            env.out(json(syncJson(out)));
            return;
          }
          const entries =
            out.conflicts.length === 0 ? [] : await listConflicts(requireWriter(ctx).workingCopy);
          env.out(syncText(out, entries));
          env.io.stderr(renderHints(out.notices));
        },
        { statusLine: (opts) => opts.background !== true },
      ),
    );

  subcommand(
    sync,
    'status',
    'Zustand des Syncs: Remote, Modus, Ungepushtes, Fehler, Konflikte',
  ).action(
    action(
      rt,
      async (env) => {
        const s = await syncStatus(await env.context());
        emit(env, statusJson(s), () => statusText(s));
      },
      { statusLine: () => false },
    ),
  );

  subcommand(
    sync,
    'resolve [id]',
    'Konflikt-Eintrag verwerfen oder trotzdem anwenden; ohne ID die Liste',
  )
    .option('--drop', 'Eintrag verwerfen')
    .option('--apply', 'Eintrag mit Vorbedingungen auf dem aktuellen Stand anwenden')
    .action(action(rt, resolve, { write: true }));
}
