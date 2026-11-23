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
import { m } from './attach.messages.ts';

/**
 * Schreibt den Anhang nach `-o <pfad>` (eine vorhandene Datei wird überschrieben). Ein Verzeichnis
 * oder ein fehlendes Elternverzeichnis ist ein Fehler des Aufrufs, kein unerwarteter.
 */
async function writeTarget(target: string, bytes: Uint8Array): Promise<void> {
  try {
    await writeFile(target, bytes);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EISDIR') throw new BackeError('validation', m.isDirectory(target));
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new BackeError('not_found', m.directoryMissing(target));
    }
    throw error;
  }
}

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
    throw new BackeError('usage', m.exactlyOneSource, {
      hint: m.sourceHint,
    });
  }
}

export function attachCommands(program: Command, rt: Runtime): void {
  const attach = subcommand(program, 'attach', m.description);

  // `--json <json|->` ist hier die Inhaltsquelle; die Ausgabe als JSON geht über `--format json`.
  subcommand(attach, m.addCommand, m.addDescription, { without: ['json'] })
    .requiredOption('--name <name>', m.nameOption)
    .option('--url <url>', m.urlOption)
    .option('--json <json|->', m.jsonOption)
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

  syncOption(subcommand(attach, 'list <id>', m.listDescription)).action(
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

  syncOption(subcommand(attach, 'get <id> <name>', m.getDescription))
    .option(m.outputFlags, m.outputOption)
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
          if (target !== undefined) await writeTarget(target, bytes as Uint8Array);
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

  subcommand(attach, 'rm <id> <name>', m.rmDescription).action(
    action(
      rt,
      async (env, ref: string, name: string) => {
        emitOutcome(env, await removeAttachment(await env.context(), ref, name), 'other');
      },
      { write: true },
    ),
  );
}
