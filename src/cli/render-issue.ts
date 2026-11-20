/**
 * Darstellung von Issues (backe.md §2.18, §2.22, §2.23): Listenzeilen, Detailansicht als Text
 * und Markdown; das JSON steht in `services/views.ts`. Alles hier ist rein und liefert Text oder
 * Objekte; geschrieben wird im Befehl.
 */
import type { State } from '../core/state.ts';
import type { IssueListItem } from '../services/issue-list.ts';
import type {
  CommentView,
  IssueDetail,
  IssueRefView,
  MissingRefView,
} from '../services/issue-show.ts';
import { lines, paint, type Style, safeText, width } from './output.ts';

/** Breite der State-Spalte: `in_progress`, der längste State. */
const STATE_WIDTH = 11;

/** Breite der Labels in der Detailansicht; Folgezeilen rücken genauso weit ein. */
const LABEL_WIDTH = 12;

const STATE_STYLE: Partial<Record<State, Style>> = {
  done: 'green',
  in_progress: 'cyan',
  review: 'cyan',
  blocked: 'red',
  on_hold: 'yellow',
  cancelled: 'dim',
  rejected: 'dim',
};

const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - width(s)));

/** Ein State in seiner Farbe; die Polsterung steht hinter der Farbe, damit Spalten stimmen. */
function stateText(state: State, color: boolean, padded: boolean): string {
  const style = STATE_STYLE[state];
  const painted = style === undefined ? state : paint(color, style, state);
  return padded ? painted + ' '.repeat(Math.max(0, STATE_WIDTH - width(state))) : painted;
}

const maxWidth = (cells: readonly string[]): number => Math.max(0, ...cells.map(width));

/**
 * Eine Zeile je Issue: `<id>  <state>  <assignee oder ->  <titel>`. IDs und Assignees auf die
 * breiteste Zeile gepolstert, der State auf 11 Zeichen; `⧗ ` vor dem Titel bei offenen
 * `depends_on`, in der Baumansicht zwei Leerzeichen Einzug je Ebene. Text aus den Dateien geht
 * durch `safeText`.
 */
export function issueLines(items: readonly IssueListItem[], color: boolean): string[] {
  return listRows(
    items.map(({ issue, depth, openDeps }) => ({
      ...issue,
      ...(depth === undefined ? {} : { depth }),
      openDeps,
    })),
    color,
  );
}

type ListRow = {
  id: string;
  state: State;
  assignee?: string | undefined;
  title: string;
  depth?: number;
  openDeps?: boolean;
};

/** Die Spalten von `issueLines` für alles, was id, state, assignee und title trägt. */
function listRows(rows: readonly ListRow[], color: boolean): string[] {
  const ids = rows.map((r) => safeText(r.id));
  const assignees = rows.map((r) => safeText(r.assignee ?? '-'));
  const idWidth = maxWidth(ids);
  const assigneeWidth = maxWidth(assignees);
  return rows.map((r, n) =>
    [
      pad(ids[n] as string, idWidth),
      stateText(r.state, color, true),
      pad(assignees[n] as string, assigneeWidth),
      `${'  '.repeat(r.depth ?? 0)}${r.openDeps ? '⧗ ' : ''}${safeText(r.title)}`,
    ].join('  '),
  );
}

/** Zeilen für Sub-Issues in den Listenspalten: `<id>  <state>  <assignee oder ->  <titel>`. */
const refLines = (refs: readonly IssueRefView[], color: boolean): string[] => listRows(refs, color);

/** `<id> [<state>]`, eine fehlende Referenz als `<id> [fehlt]`. */
const refWithState = (r: IssueRefView | MissingRefView, color: boolean): string =>
  'missing' in r
    ? `${safeText(r.id)} [${paint(color, 'red', 'fehlt')}]`
    : `${safeText(r.id)} [${stateText(r.state, color, false)}]`;

const firstLine = (body: string): string => body.split('\n', 1)[0] ?? '';

/** Body ohne abschließende Zeilenumbrüche, als Zeilen; ein leerer Body ergibt keine. */
const bodyLines = (body: string): string[] => {
  const trimmed = safeText(body).replace(/\n+$/, '');
  return trimmed === '' ? [] : trimmed.split('\n');
};

/** `--- <file> (<author>, <created>[, <from> → <to>])` */
function commentHeading(c: CommentView): string {
  const transition = c.from !== undefined && c.to !== undefined ? `, ${c.from} → ${c.to}` : '';
  return safeText(`--- ${c.file} (${c.author}, ${c.created}${transition})`);
}

/**
 * Detailansicht als Text: Kopf `<id>  <titel>`, dann gesetzte Felder mit Labels auf 12 Zeichen,
 * eine Leerzeile, der Body und je angefordertem Kommentar eine Leerzeile, Überschrift und Text.
 * Text aus den Dateien geht durch `safeText`; nur die States tragen Farbe.
 */
export function issueDetailText(d: IssueDetail, color: boolean): string {
  const i = d.issue;
  const out: string[] = [`${safeText(i.id)}  ${paint(color, 'bold', i.title)}`];
  /** `value` ist schon sicher (gefärbte States, bereinigte Teile). */
  const field = (label: string, value: string | undefined): void => {
    if (value !== undefined && value !== '') out.push(`${pad(label, LABEL_WIDTH)}${value}`);
  };
  const plain = (label: string, value: string | undefined): void =>
    field(label, value === undefined ? undefined : safeText(value));
  const more = (value: string): void => {
    out.push(`${' '.repeat(LABEL_WIDTH)}${value}`);
  };
  const joined = (list: readonly string[] | undefined): string | undefined =>
    list === undefined || list.length === 0 ? undefined : list.join(', ');

  let state = stateText(i.state, color, false);
  if (i.paused_from !== undefined) state += ` (aus ${safeText(i.paused_from)})`;
  if (i.blocked_by !== undefined && i.blocked_by.length > 0) {
    const blockers = i.blocked_by.map((id) => {
      const ref = d.blockedBy.find((b) => b.id === id);
      return ref === undefined ? safeText(id) : refWithState(ref, color);
    });
    state += `, blockiert von ${blockers.join(', ')}`;
  }
  field('state', state);
  if (d.lastReason !== undefined) {
    const r = d.lastReason;
    plain('reason', `${firstLine(r.body)} — ${r.author}, ${r.created}`);
  }
  plain('assignee', i.assignee);
  plain('creator', i.creator);
  plain('created', i.created);
  // Vom direkten Parent bis zur Wurzel, in der Reihenfolge von `parents`.
  plain('parent', d.parents.map((p) => p.id).join(' › '));
  field('depends_on', joined(d.dependsOn.map((r) => refWithState(r, color))));
  field('dependents', joined(d.dependents.map((r) => refWithState(r, color))));
  if (d.progress !== undefined) {
    field('children', `${d.progress.settled}/${d.progress.total} erledigt`);
    for (const line of refLines(d.children, color)) more(line);
  }
  field('rank', i.rank === undefined ? undefined : String(i.rank));
  plain('projects', joined(i.projects));
  plain('sprints', joined(i.sprints));
  plain('repos', joined(i.repos));
  plain('attachments', joined(i.attachments?.map((a) => `${a.name} (${a.file ?? a.url})`)));
  const props = Object.entries(i.props ?? {}).map(([k, v]) =>
    safeText(`${k}: ${JSON.stringify(v)}`),
  );
  if (props.length > 0) {
    field('props', props[0]);
    for (const line of props.slice(1)) more(line);
  }
  field('comments', d.commentsCount === 0 ? undefined : String(d.commentsCount));

  const body = bodyLines(d.body);
  if (body.length > 0) out.push('', ...body);
  for (const c of d.comments) out.push('', commentHeading(c), ...bodyLines(c.body));
  return lines(out);
}

/** Die Issue-Datei wie auf der Platte, je angefordertem Kommentar ein Trenner und dessen Datei. */
export function issueDetailMd(d: IssueDetail): string {
  return (
    d.raw +
    d.comments.map((c, n) => `\n<!-- comments/${c.file} -->\n${d.rawComments[n] ?? ''}`).join('')
  );
}
