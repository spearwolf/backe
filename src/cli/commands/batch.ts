/** `backe batch` (backe.md §2.16.6): Operationen als JSONL in einem Commit. */
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import { summarizeBatch } from '../../ops/operation.ts';
import { runBatch } from '../../services/batch.ts';
import { batchJson } from '../../services/views.ts';
import {
  action,
  type CommandEnv,
  emitNotices,
  fileText,
  type Runtime,
  subcommand,
  text,
} from '../options.ts';
import { m as outputMessages } from '../output.messages.ts';
import { columns, json, lines } from '../output.ts';
import { m } from './batch.messages.ts';

/** Der Batch-Text aus `-f <pfad|->` oder `-` (stdin); genau eine Quelle. */
async function inputOf(
  env: CommandEnv,
  file: string | undefined,
  dash: string | undefined,
): Promise<string> {
  if (dash !== undefined && dash !== '-') {
    throw new BackeError('usage', m.unexpectedArgument(dash), {
      hint: m.sourceHint,
    });
  }
  if (file !== undefined && dash !== undefined) {
    throw new BackeError('usage', m.fileAndStdinExclusive);
  }
  const source = file ?? dash;
  if (source === undefined) {
    throw new BackeError('usage', m.noInput, {
      hint: m.noInputHint,
    });
  }
  return source === '-' ? text('-', env.io, env.stdin) : fileText(source, env.io);
}

export function batchCommand(program: Command, rt: Runtime): void {
  subcommand(program, m.command, m.description)
    .option(m.fileFlags, m.fileOption)
    .action(
      action(
        rt,
        async (env, dash: string | undefined, opts: { file?: string }) => {
          const input = await inputOf(env, opts.file, dash);
          const r = await runBatch(await env.context(), input);
          env.committed(r.commit);
          if (env.format === 'json') {
            env.out(json(batchJson(r)));
            return;
          }
          env.out(
            lines([
              r.ops.length === 0 ? `${outputMessages.unchanged} batch` : summarizeBatch(r.ops),
              ...columns(Object.entries(r.refs)),
            ]),
          );
          emitNotices(env, r.notices, r.warnings);
        },
        { write: true },
      ),
    );
}
