/** `backe batch` (backe.md §2.16.6): Operationen als JSONL in einem Commit. */
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import { summarizeBatch } from '../../ops/operation.ts';
import { runBatch } from '../../services/batch.ts';
import {
  action,
  type CommandEnv,
  emitNotices,
  fileText,
  type Runtime,
  subcommand,
  text,
} from '../options.ts';
import { columns, json, lines } from '../output.ts';

/** Der Batch-Text aus `-f <pfad|->` oder `-` (stdin); genau eine Quelle. */
async function inputOf(
  env: CommandEnv,
  file: string | undefined,
  dash: string | undefined,
): Promise<string> {
  if (dash !== undefined && dash !== '-') {
    throw new BackeError('usage', `Unerwartetes Argument »${dash}«`, {
      hint: 'Quelle: -f <pfad> oder - (stdin)',
    });
  }
  if (file !== undefined && dash !== undefined) {
    throw new BackeError('usage', '-f und - schließen sich aus');
  }
  const source = file ?? dash;
  if (source === undefined) {
    throw new BackeError('usage', 'Keine Eingabe angegeben', {
      hint: '-f <pfad>, -f - oder - (stdin)',
    });
  }
  return source === '-' ? text('-', env.io, env.stdin) : fileText(source, env.io);
}

export function batchCommand(program: Command, rt: Runtime): void {
  subcommand(program, 'batch [quelle]', 'Operationen als JSONL in einem Commit ausführen')
    .option('-f, --file <pfad|->', 'JSONL-Datei (»-« liest stdin)')
    .action(
      action(rt, async (env, dash: string | undefined, opts: { file?: string }) => {
        const input = await inputOf(env, opts.file, dash);
        const r = await runBatch(await env.context(), input);
        if (env.format === 'json') {
          env.out(
            json({
              commit: r.commit ?? null,
              refs: r.refs,
              ops: r.ops.length,
              notices: r.notices.length === 0 ? undefined : r.notices,
              warnings: r.warnings.length === 0 ? undefined : r.warnings,
            }),
          );
          return;
        }
        env.out(
          lines([
            r.ops.length === 0 ? 'unverändert: batch' : summarizeBatch(r.ops),
            ...columns(Object.entries(r.refs)),
          ]),
        );
        emitNotices(env, r.notices, r.warnings);
      }),
    );
}
