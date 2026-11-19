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
  text,
} from '../options.ts';
import { columns, lines } from '../output.ts';

type MessageOpts = { message?: string; file?: string };

/** Text aus `-m <md|->` oder `-F <pfad>`; genau eines von beiden. */
async function messageOf(env: CommandEnv, opts: MessageOpts): Promise<string> {
  if (opts.message !== undefined && opts.file !== undefined) {
    throw new BackeError('usage', '-m und -F schließen sich aus');
  }
  if (opts.message !== undefined) return text(opts.message, env.io, env.stdin);
  if (opts.file !== undefined) return fileText(opts.file, env.io);
  throw new BackeError('usage', '-m oder -F angeben', {
    hint: '-m <text>, -m - (stdin) oder -F <datei>',
  });
}

function messageOptions(cmd: Command): Command {
  return cmd
    .option('-m, --message <md|->', 'Text (»-« liest stdin)')
    .option('-F, --file <pfad>', 'Text aus Datei');
}

export function commentCommands(program: Command, rt: Runtime): void {
  const comment = subcommand(program, 'comment', 'Kommentare eines Issues');

  messageOptions(subcommand(comment, 'add <id>', 'Kommentar anlegen')).action(
    action(rt, async (env, ref: string, opts: MessageOpts) => {
      const body = await messageOf(env, opts);
      emitOutcome(env, await addComment(await env.context(), ref, body), 'other');
    }),
  );

  subcommand(comment, 'list <id>', 'Kommentare chronologisch, mit Nummer für edit und delete')
    .option('--limit <n>', 'nur die letzten n')
    .action(
      action(rt, async (env, ref: string, opts: { limit?: string }) => {
        const limit = limitArg(opts.limit);
        // Die Nummer zählt in der ganzen Liste, damit sie auch nach --limit für edit/delete taugt.
        const all = await listIssueComments(await env.context(), ref);
        const from = limit === undefined ? 0 : Math.max(0, all.length - limit);
        const shown = all.slice(from);
        emit(env, shown, () =>
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
      }),
    );

  messageOptions(
    subcommand(
      comment,
      'edit <id> <kommentar>',
      'eigenen Kommentar ändern (Dateiname oder Nummer)',
    ),
  ).action(
    action(rt, async (env, ref: string, which: string, opts: MessageOpts) => {
      const body = await messageOf(env, opts);
      emitOutcome(env, await editComment(await env.context(), ref, which, body), 'other');
    }),
  );

  subcommand(
    comment,
    'delete <id> <kommentar>',
    'eigenen Kommentar löschen (Dateiname oder Nummer)',
  ).action(
    action(rt, async (env, ref: string, which: string) => {
      emitOutcome(env, await deleteComment(await env.context(), ref, which), 'other');
    }),
  );
}
