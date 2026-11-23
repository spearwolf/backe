/**
 * `backe sync [--background] [--interactive]`, `sync status` und `sync resolve [<id>]
 * [--drop | --apply]` (backe.md §2.16.2, §2.16.4).
 */
import type { Command } from 'commander';
import { requireWriter } from '../../context/resolve.ts';
import { BackeError } from '../../core/errors.ts';
import { summarizeBatch, summarizeOp } from '../../ops/operation.ts';
import { runBackground, type SyncStatus, syncStatus } from '../../services/background.ts';
import { resolveConflict } from '../../services/resolve.ts';
import { type SyncOutcome, syncNow } from '../../services/sync.ts';
import { type ConflictEntry, listConflicts } from '../../services/sync-state.ts';
import { syncJson } from '../../services/views.ts';
import { action, type CommandEnv, emit, type Runtime, subcommand } from '../options.ts';
import { m as outputMessages } from '../output.messages.ts';
import { json, lines, renderError, renderHints, safeText } from '../output.ts';
import { interactiveResolver } from '../prompt.ts';
import { m } from './sync.messages.ts';

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
  if (out.skipped !== undefined) return `${m.noRemote}\n`;
  const subjects = new Map(entries.map((e) => [e.id, subjectOf(e)]));
  const rows: string[] = [];
  if (out.fetched > 0) rows.push(m.fetched(out.fetched));
  if (out.replayed > 0) rows.push(m.replayed(out.replayed));
  for (const id of out.conflicts) rows.push(m.conflict(id, subjects.get(id) ?? ''));
  if (out.pushed !== undefined) rows.push(m.pushed(short(out.pushed)));
  return rows.length === 0 ? `${m.upToDate}\n` : lines(rows.map(safeText));
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
    `${m.labelRemote}  ${s.remote ?? m.noRemote}`,
    `${m.labelMode}  ${s.mode}`,
    `${m.labelUnpushed}  ${s.unpushed}`,
    `${m.labelLastSync}  ${s.state.last_attempt ?? m.never}`,
  ];
  if (s.state.last_error !== undefined) rows.push(`${m.labelError}  ${s.state.last_error.message}`);
  if (s.running) rows.push(`${m.labelRunning}  ${m.yes}`);
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
      throw new BackeError('usage', m.dropAndApplyNeedId, {
        hint: m.dropAndApplyNeedIdHint,
      });
    }
    const { conflicts } = await syncStatus(ctx);
    emit(env, { conflicts: conflicts.map(conflictJson) }, () => lines(conflictLines(conflicts)));
    return;
  }
  if ((opts.drop === true) === (opts.apply === true)) {
    throw new BackeError('usage', m.exactlyOneOfDropApply, {
      hint: m.resolveHint(id),
    });
  }
  const how = opts.drop === true ? 'drop' : 'apply';
  const r = await resolveConflict(ctx, id, how);
  env.committed(r.commit);
  emit(env, { id, action: how, commit: r.commit ?? null, ops: r.ops }, () => {
    if (how === 'drop') return `${m.dropped(safeText(id))}\n`;
    const [only] = r.ops;
    const summary =
      r.ops.length === 1 && only !== undefined ? summarizeOp(only) : summarizeBatch(r.ops);
    return `${r.commit === undefined ? `${outputMessages.unchanged} ` : ''}${safeText(summary)}\n`;
  });
}

export function syncCommands(program: Command, rt: Runtime): void {
  const sync = subcommand(program, 'sync', m.description)
    .option('--background', m.backgroundOption)
    .option('--interactive', m.interactiveOption)
    .action(
      action(
        rt,
        async (env, opts: SyncOpts) => {
          if (opts.background === true) {
            if (opts.interactive !== true) return background(env);
            throw new BackeError('usage', m.backgroundExcludesInteractive);
          }
          if (opts.interactive === true && !(env.io.stdinIsTTY && env.io.isTTY)) {
            throw new BackeError('usage', m.interactiveNeedsTerminal);
          }
          const ctx = await env.context();
          const out = await syncNow(
            ctx,
            opts.interactive === true ? { resolveManual: interactiveResolver(env.io) } : {},
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

  subcommand(sync, 'status', m.statusDescription).action(
    action(
      rt,
      async (env) => {
        const s = await syncStatus(await env.context());
        emit(env, statusJson(s), () => statusText(s));
      },
      { statusLine: () => false },
    ),
  );

  subcommand(sync, 'resolve [id]', m.resolveDescription)
    .option('--drop', m.dropOption)
    .option('--apply', m.applyOption)
    .action(action(rt, resolve, { write: true }));
}
