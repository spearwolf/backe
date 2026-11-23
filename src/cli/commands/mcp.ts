/** `backe mcp [--allow-delete]` (backe.md §2.19): MCP-Server über stdio. */
import type { Command } from 'commander';
import { runStdio } from '../../mcp/stdio.ts';
import { action, globalOpts, type Runtime, subcommand } from '../options.ts';
import { m } from './mcp.messages.ts';

type Opts = { allowDelete?: boolean };

export function mcpCommand(program: Command, rt: Runtime): void {
  subcommand(program, 'mcp', m.description)
    .option('--allow-delete', m.allowDeleteOption)
    .action((opts: Opts, cmd: Command) => {
      // Der Server löst den Kontext je Tool-Aufruf neu auf und braucht dafür die rohen Flags,
      // nicht einen aufgelösten Kontext; `-B` und `--as` dürfen vor oder nach `mcp` stehen.
      const { backlog, as } = globalOpts(cmd);
      return action(
        rt,
        async (env) => {
          await runStdio(
            {
              cwd: env.io.cwd,
              env: env.io.env,
              flags: {
                ...(backlog === undefined ? {} : { backlog }),
                ...(as === undefined ? {} : { as }),
              },
              allowDelete: opts.allowDelete === true,
            },
            { stdin: process.stdin, stdout: process.stdout, stderr: (s) => env.io.stderr(s) },
          );
        },
        { statusLine: () => false },
      )(opts, cmd);
    });
}
