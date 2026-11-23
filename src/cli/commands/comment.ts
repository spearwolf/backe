/** `backe comment add | list | edit | delete` (backe.md §2.7, §2.17). */
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import {
  addComment,
  deleteComment,
  editComment,
  listIssueComments,
} from '../../services/comments.ts';
import {
  action,
  type CommandEnv,
  emit,
  emitOutcome,
  fileText,
  limitArg,
  type Runtime,
  subcommand,
  syncOption,
  text,
} from '../options.ts';
import { columns, lines } from '../output.ts';
import { m } from './comment.messages.ts';

type MessageOpts = { message?: string; file?: string };

/** Text aus `-m <md|->` oder `-F <pfad>`; genau eines von beiden. */
async function messageOf(env: CommandEnv, opts: MessageOpts): Promise<string> {
  if (opts.message !== undefined && opts.file !== undefined) {
    throw new BackeError('usage', m.messageAndFileExclusive);
  }
  if (opts.message !== undefined) return text(opts.message, env.io, env.stdin);
  if (opts.file !== undefined) return fileText(opts.file, env.io);
  throw new BackeError('usage', m.messageOrFileRequired, {
    hint: m.messageOrFileHint,
  });
}

function messageOptions(cmd: Command): Command {
  return cmd.option(m.messageFlags, m.messageOption).option(m.fileFlags, m.fileOption);
}

export function commentCommands(program: Command, rt: Runtime): void {
  const comment = subcommand(program, 'comment', m.description);

  messageOptions(subcommand(comment, 'add <id>', m.addDescription)).action(
    action(
      rt,
      async (env, ref: string, opts: MessageOpts) => {
        const body = await messageOf(env, opts);
        emitOutcome(env, await addComment(await env.context(), ref, body), 'other');
      },
      { write: true },
    ),
  );

  syncOption(subcommand(comment, 'list <id>', m.listDescription))
    .option('--limit <n>', m.limitOption)
    .action(
      action(
        rt,
        async (env, ref: string, opts: { limit?: string }) => {
          const limit = limitArg(opts.limit);
          // Die Nummer zählt in der ganzen Liste, damit sie auch nach --limit für edit/delete taugt.
          const all = await listIssueComments(await env.context(), ref);
          const from = limit === undefined ? 0 : Math.max(0, all.length - limit);
          const shown = all.slice(from);
          // JSON trägt dieselbe Nummer `n`, die `comment edit|delete` annehmen.
          const numbered = shown.map((c, i) => ({ n: from + i + 1, ...c }));
          emit(env, numbered, () =>
            lines(
              columns(
                shown.map((c, i) => [
                  String(from + i + 1),
                  c.file,
                  c.author,
                  c.body.split('\n', 1)[0] ?? '',
                ]),
              ),
            ),
          );
        },
        { read: true },
      ),
    );

  messageOptions(subcommand(comment, m.editCommand, m.editDescription)).action(
    action(
      rt,
      async (env, ref: string, which: string, opts: MessageOpts) => {
        const body = await messageOf(env, opts);
        emitOutcome(env, await editComment(await env.context(), ref, which, body), 'other');
      },
      { write: true },
    ),
  );

  subcommand(comment, m.deleteCommand, m.deleteDescription).action(
    action(
      rt,
      async (env, ref: string, which: string) => {
        emitOutcome(env, await deleteComment(await env.context(), ref, which), 'other');
      },
      { write: true },
    ),
  );
}
