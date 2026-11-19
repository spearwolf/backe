/** `backe config get | set | edit` (backe.md §2.15.1, §2.17). */
import { rm } from 'node:fs/promises';
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import { editConfigText, getConfig, setConfig } from '../../services/config.ts';
import { editorCommand, editText } from '../editor.ts';
import { action, type Runtime, subcommand } from '../options.ts';
import { json, safeText } from '../output.ts';

export function configCommands(program: Command, rt: Runtime): void {
  const config = subcommand(program, 'config', 'User-Config lesen, setzen und bearbeiten');

  // `get` und `edit` laufen auch mit kaputter Config: `get` meldet den Fehler selbst, `edit`
  // repariert ihn.
  subcommand(config, 'get [key]', 'Wert oder die ganze Config ausgeben').action(
    action(
      rt,
      async (env, key: string | undefined) => {
        const r = await getConfig(env.homes, key);
        if (env.format === 'json') {
          env.out(json(key === undefined ? r.config : r.value));
        } else if (key === undefined) {
          env.out(safeText(r.text ?? ''));
        } else {
          env.out(`${safeText(typeof r.value === 'string' ? r.value : JSON.stringify(r.value))}\n`);
        }
      },
      { lenientConfig: true },
    ),
  );

  subcommand(config, 'set <key> [wert]', 'Wert setzen; --unset entfernt den Key')
    .option('--unset', 'Key entfernen')
    .action(
      action(rt, async (env, key: string, value: string | undefined, opts: { unset?: boolean }) => {
        if (opts.unset === true && value !== undefined) {
          throw new BackeError('usage', 'Wert und --unset schließen sich aus');
        }
        if (opts.unset !== true && value === undefined) {
          throw new BackeError('usage', 'Wert fehlt', { hint: 'config set <key> <wert>' });
        }
        await setConfig(env.homes, key, opts.unset === true ? undefined : value);
      }),
    );

  subcommand(config, 'edit', 'Config im Editor bearbeiten').action(
    action(
      rt,
      async (env) => {
        if (editorCommand(env.io) === undefined) {
          throw new BackeError('usage', 'Kein Editor verfügbar', { hint: 'BACKE_EDITOR setzen' });
        }
        const r = await editConfigText(env.homes, async (text) => {
          const edited = await editText(env.io, 'config', text, 'jsonc');
          await rm(edited.file, { force: true });
          return edited.text;
        });
        if (!r.changed) env.out(env.format === 'json' ? json({ changed: false }) : 'unverändert\n');
      },
      { lenientConfig: true },
    ),
  );
}
