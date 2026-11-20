/** `backe attach add | list | get | rm` (backe.md §2.8): Anhänge eines Issues. */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Command } from 'commander';
import { isMissing } from '../../context/paths.ts';
import { BackeError } from '../../core/errors.ts';
import {
  type AttachSource,
  addAttachment,
  getAttachment,
  listAttachments,
  removeAttachment,
} from '../../services/attachments.ts';
import {
  absPath,
  action,
  type CommandEnv,
  emit,
  emitOutcome,
  type Runtime,
  subcommand,
  syncOption,
  text,
} from '../options.ts';
import { columns, json, lines } from '../output.ts';

type AddOpts = { name: string; url?: string; json?: string };

/** Die Quelle eines Anhangs: genau eine von Datei, `--url` und `--json`. */
async function sourceOf(
  env: CommandEnv,
  file: string | undefined,
  opts: AddOpts,
): Promise<AttachSource> {
  const given = [file, opts.url, opts.json].filter((v) => v !== undefined).length;
  if (given !== 1) {
    throw new BackeError('usage', 'Genau eine Quelle angeben', {
      hint: '<datei>, --url <url> oder --json <json|->',
    });
  }
  if (opts.url !== undefined) return { kind: 'url', url: opts.url };
  if (opts.json !== undefined) {
    return { kind: 'json', text: await text(opts.json, env.io, env.stdin) };
  }
  const path = absPath(file as string, env.io);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(path);
  } catch (error) {
    if (isMissing(error)) throw new BackeError('not_found', `Datei »${file}« nicht gefunden`);
    throw new BackeError('unexpected', `»${path}«: ${(error as NodeJS.ErrnoException).code}`);
  }
  if (!info.isFile()) throw new BackeError('validation', `${path} ist keine Datei`);
  return { kind: 'file', fileName: basename(path), content: await readFile(path) };
}

export function attachCommands(program: Command, rt: Runtime): void {
  const attach = subcommand(program, 'attach', 'Anhänge eines Issues');

  // `--json <json|->` ist hier die Inhaltsquelle; die Ausgabe als JSON geht über `--format json`.
  subcommand(attach, 'add <id> [datei]', 'Datei, URL oder JSON anhängen', { without: ['json'] })
    .requiredOption('--name <name>', 'Name des Anhangs')
    .option('--url <url>', 'URL statt Datei')
    .option('--json <json|->', 'JSON-Inhalt (»-« liest stdin)')
    .action(
      action(
        rt,
        async (env, ref: string, file: string | undefined, opts: AddOpts) => {
          const source = await sourceOf(env, file, opts);
          const r = await addAttachment(await env.context(), ref, { name: opts.name, source });
          emitOutcome(env, r, 'other');
        },
        { write: true },
      ),
    );

  syncOption(subcommand(attach, 'list <id>', 'Anhänge auflisten')).action(
    action(
      rt,
      async (env, ref: string) => {
        const list = await listAttachments(await env.context(), ref);
        emit(env, list, () =>
          lines(columns(list.map((a) => [a.name, a.file ?? a.url ?? '', String(a.size ?? '-')]))),
        );
      },
      { read: true },
    ),
  );

  syncOption(
    subcommand(
      attach,
      'get <id> <name>',
      'Anhang holen: Inhalt nach stdout oder mit -o in eine Datei',
    ),
  )
    .option('-o, --output <pfad>', 'in diese Datei schreiben (überschreibt) und den Pfad drucken')
    .action(
      action(
        rt,
        async (env, ref: string, name: string, opts: { output?: string }) => {
          const a = await getAttachment(await env.context(), ref, name);
          if ('url' in a) {
            emit(env, { name: a.name, url: a.url }, () => `${a.url}\n`);
            return;
          }
          const target = opts.output === undefined ? undefined : absPath(opts.output, env.io);
          const bytes =
            env.format === 'json' && target === undefined ? undefined : await readFile(a.path);
          if (target !== undefined) await writeFile(target, bytes as Uint8Array);
          if (env.format === 'json') {
            env.out(json({ name: a.name, file: a.file, size: a.size, path: target ?? a.path }));
          } else if (target !== undefined) {
            env.out(`${target}\n`);
          } else {
            env.io.stdoutBytes(bytes as Uint8Array);
          }
        },
        { read: true },
      ),
    );

  subcommand(attach, 'rm <id> <name>', 'Anhang entfernen').action(
    action(
      rt,
      async (env, ref: string, name: string) => {
        emitOutcome(env, await removeAttachment(await env.context(), ref, name), 'other');
      },
      { write: true },
    ),
  );
}
