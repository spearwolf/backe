/** `backe context [--project p] [--sprint s] [--props]` (backe.md §2.14, §2.24). */
import type { Command } from 'commander';
import type { Source } from '../../context/resolve.ts';
import type { BacklogConfig } from '../../core/schemas.ts';
import { type ContextInfo, contextInfo } from '../../services/context-info.ts';
import { contextJson } from '../../services/views.ts';
import { action, emit, type Runtime, subcommand, syncOption } from '../options.ts';
import { columns, lines, paint, safeText, width } from '../output.ts';

type Opts = { project?: string; sprint?: string; props?: boolean };

const sourceText = (s: Source) => `(${s.kind}${s.detail === undefined ? '' : `: ${s.detail}`})`;

function declarations(props: BacklogConfig['props']): string[] {
  const keys = Object.keys(props).sort();
  if (keys.length === 0) return ['keine Properties deklariert'];
  return columns(
    keys.map((key) => {
      const d = props[key] as BacklogConfig['props'][string];
      const values = d.values?.join(d.ordered === true ? ' > ' : ', ');
      return [key, values === undefined ? d.type : `${d.type} (${values})`, d.description];
    }),
  );
}

/**
 * Je Wert eine Zeile `<name>  <wert oder ->  (<quelle>[: detail])`; `root` und `key` ohne Quelle,
 * zuletzt `schreiben: ja|nein`; mit `--props` folgen die Deklarationen nach einer Leerzeile.
 */
function render(info: ContextInfo, color: boolean): string {
  const rows: [string, string, Source][] = [
    ['backlog', info.backlog.value, info.backlog.source],
    ['user', info.user.value ?? '-', info.user.source],
    ['project', info.project.value ?? '-', info.project.source],
    ['sprint', info.sprint.value ?? '-', info.sprint.source],
    ['repo', info.repo.value ?? '-', info.repo.source],
  ];
  // Name und Wert gepolstert, die Quelle zuletzt und gefärbt; Werte gehen durch `safeText`.
  const pad = (s: string, w: number) => s + ' '.repeat(w - width(s));
  const nameWidth = Math.max(...rows.map(([name]) => width(name)));
  const valueWidth = Math.max(...rows.map(([, value]) => width(safeText(value))));
  const [backlog, user, ...scoped] = rows.map(
    ([name, value, source]) =>
      `${pad(name, nameWidth)}  ${pad(safeText(value), valueWidth)}  ${paint(color, 'dim', sourceText(source))}`,
  );
  const plain = (name: string, value: string) => `${pad(name, nameWidth)}  ${safeText(value)}`;
  const out = [
    backlog as string,
    plain('root', info.backlog.root ?? '-'),
    user as string,
    plain('key', info.user.key ?? '-'),
    ...scoped,
    `schreiben: ${info.user.canWrite ? 'ja' : paint(color, 'yellow', 'nein')}`,
  ];
  if (info.props !== undefined) out.push('', ...declarations(info.props));
  return lines(out);
}

export function contextCommand(program: Command, rt: Runtime): void {
  syncOption(subcommand(program, 'context', 'aufgelösten Kontext mit Herkunft jedes Werts zeigen'))
    .option('--project <pfad>', 'Projekt für diesen Aufruf')
    .option('--sprint <slug>', 'Sprint für diesen Aufruf')
    .option('--props', 'Property-Deklarationen des Backlogs anhängen')
    .action(
      action(
        rt,
        async (env, opts: Opts) => {
          const ctx = await env.context({ project: opts.project, sprint: opts.sprint });
          const info = await contextInfo(ctx, { props: opts.props === true });
          emit(env, contextJson(info), () => render(info, env.color));
        },
        { read: true },
      ),
    );
}
