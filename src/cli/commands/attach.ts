/** `backe attach add | list | get | rm` (backe.md §2.8): Anhänge eines Issues. */
import { readFile, writeFile } from 'node:fs/promises';
import type { Command } from 'commander';
import type { ResolvedContext } from '../../context/resolve.ts';
import { BackeError } from '../../core/errors.ts';
import {
  type AttachmentSource,
  addAttachment,
  attachmentLimits,
  getAttachment,
  listAttachments,
  loadAttachmentSource,
  removeAttachment,
} from '../../services/attachments.ts';
import { attachmentJson } from '../../services/views.ts';
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

/**
 * Die Quelle eines Anhangs: genau eine von Datei, `--url` und `--json`. Die Datei darf überall
 * liegen, wo der User lesen kann (backe.md §2.8); nur der MCP-Modus begrenzt sie.
 */
async function sourceOf(
  env: CommandEnv,
  ctx: ResolvedContext,
  file: string | undefined,
  opts: AddOpts,
): Promise<AttachmentSource> {
  const json = opts.json === undefined ? undefined : await text(opts.json, env.io, env.stdin);
  return loadAttachmentSource(
    { name: opts.name, path: file, url: opts.url, json },
    { base: env.io.cwd, home: ctx.homes.home, ...(await attachmentLimits(ctx)), confine: false },
  );
}

/** Genau eine Quelle, geprüft vor dem Kontext und vor stdin. */
function checkOneSource(file: string | undefined, opts: AddOpts): void {
  const given = [file, opts.url, opts.json].filter((v) => v !== undefined).length;
  if (given !== 1) {
    throw new BackeError('usage', 'Genau eine Quelle angeben', {
      hint: '<datei>, --url <url> oder --json <json|->',
    });
  }
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
          checkOneSource(file, opts);
          const ctx = await env.context();
          const source = await sourceOf(env, ctx, file, opts);
          const r = await addAttachment(ctx, ref, { name: opts.name, source });
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
            emit(env, attachmentJson(a), () => `${a.url}\n`);
            return;
          }
          const target = opts.output === undefined ? undefined : absPath(opts.output, env.io);
          const bytes =
            env.format === 'json' && target === undefined ? undefined : await readFile(a.path);
          if (target !== undefined) await writeFile(target, bytes as Uint8Array);
          if (env.format === 'json') {
            env.out(json(attachmentJson(a, target)));
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
