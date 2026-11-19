/**
 * Darstellung von Issues (backe.md §2.18, §2.22, §2.23): Listenzeilen, Detailansicht als Text,
 * JSON und Markdown. Alles hier ist rein und liefert Text oder Objekte; geschrieben wird im Befehl.
 */
import { KEY_ORDER } from '../core/schemas.ts';
import type { State } from '../core/state.ts';
import type { IssueListItem } from '../services/issue-list.ts';
import type { CommentView, IssueDetail, IssueRefView } from '../services/issue-show.ts';
import { lines, paint, type Style, width } from './output.ts';

/** Felder eines Issues, wie sie in der Datei stehen; Grundlage für `--fields`. */
export const ISSUE_FIELDS: readonly string[] = KEY_ORDER.issue;

/** Erlaubte Felder für `issue list --fields`: Issue-Felder plus Baumtiefe und offene Abhängigkeiten. */
export const LIST_FIELDS: readonly string[] = [...ISSUE_FIELDS, 'depth', 'open_deps'];

/** Erlaubte Felder für `issue show --fields`: alles, was `issueDetailJson` liefern kann. */
export const SHOW_FIELDS: readonly string[] = [
  ...ISSUE_FIELDS,
  'body',
  'parents',
  'dependents',
  'children',
  'progress',
  'comments_count',
  'last_reason',
  'comments',
  'notices',
];

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
 * `depends_on`, in der Baumansicht zwei Leerzeichen Einzug je Ebene.
 */
export function issueLines(items: readonly IssueListItem[], color: boolean): string[] {
  const idWidth = maxWidth(items.map((i) => i.issue.id));
  const assigneeWidth = maxWidth(items.map((i) => i.issue.assignee ?? '-'));
  return items.map(({ issue, depth, openDeps }) =>
    [
      pad(issue.id, idWidth),
      stateText(issue.state, color, true),
      pad(issue.assignee ?? '-', assigneeWidth),
      `${'  '.repeat(depth ?? 0)}${openDeps ? '⧗ ' : ''}${issue.title}`,
    ].join('  '),
  );
}

/** Zeilen für Sub-Issues: `<id>  <state>  <titel>`; eine Referenz trägt keinen Assignee. */
function refLines(refs: readonly IssueRefView[], color: boolean): string[] {
  const idWidth = maxWidth(refs.map((r) => r.id));
  return refs.map((r) => [pad(r.id, idWidth), stateText(r.state, color, true), r.title].join('  '));
}

const refWithState = (r: IssueRefView, color: boolean): string =>
  `${r.id} [${stateText(r.state, color, false)}]`;

const firstLine = (body: string): string => body.split('\n', 1)[0] ?? '';

/** Body ohne abschließende Zeilenumbrüche, als Zeilen; ein leerer Body ergibt keine. */
const bodyLines = (body: string): string[] => {
  const trimmed = body.replace(/\n+$/, '');
  return trimmed === '' ? [] : trimmed.split('\n');
};

/** `--- <file> (<author>, <created>[, <from> → <to>])` */
function commentHeading(c: CommentView): string {
  const transition = c.from !== undefined && c.to !== undefined ? `, ${c.from} → ${c.to}` : '';
  return `--- ${c.file} (${c.author}, ${c.created}${transition})`;
}

/**
 * Detailansicht als Text: Kopf `<id>  <titel>`, dann gesetzte Felder mit Labels auf 12 Zeichen,
 * eine Leerzeile, der Body und je angefordertem Kommentar eine Leerzeile, Überschrift und Text.
 */
export function issueDetailText(d: IssueDetail, color: boolean): string {
  const i = d.issue;
  const out: string[] = [`${i.id}  ${paint(color, 'bold', i.title)}`];
  const field = (label: string, value: string | undefined): void => {
    if (value !== undefined && value !== '') out.push(`${pad(label, LABEL_WIDTH)}${value}`);
  };
  const more = (value: string): void => {
    out.push(`${' '.repeat(LABEL_WIDTH)}${value}`);
  };
  const joined = (list: readonly string[] | undefined): string | undefined =>
    list === undefined || list.length === 0 ? undefined : list.join(', ');

  let state = stateText(i.state, color, false);
  if (i.paused_from !== undefined) state += ` (aus ${i.paused_from})`;
  if (i.blocked_by !== undefined && i.blocked_by.length > 0) {
    const blockers = i.blocked_by.map((id) => {
      const ref = d.blockedBy.find((b) => b.id === id);
      return ref === undefined ? id : refWithState(ref, color);
    });
    state += `, blockiert von ${blockers.join(', ')}`;
  }
  field('state', state);
  if (d.lastReason !== undefined) {
    const r = d.lastReason;
    field('reason', `${firstLine(r.body)} — ${r.author}, ${r.created}`);
  }
  field('assignee', i.assignee);
  field('creator', i.creator);
  field('created', i.created);
  // Vom direkten Parent bis zur Wurzel, in der Reihenfolge von `parents`.
  field('parent', d.parents.map((p) => p.id).join(' › '));
  field('depends_on', joined(d.dependsOn.map((r) => refWithState(r, color))));
  field('dependents', joined(d.dependents.map((r) => refWithState(r, color))));
  if (d.progress !== undefined) {
    field('children', `${d.progress.settled}/${d.progress.total} erledigt`);
    for (const line of refLines(d.children, color)) more(line);
  }
  field('rank', i.rank === undefined ? undefined : String(i.rank));
  field('projects', joined(i.projects));
  field('sprints', joined(i.sprints));
  field('repos', joined(i.repos));
  field('attachments', joined(i.attachments?.map((a) => `${a.name} (${a.file ?? a.url})`)));
  const props = Object.entries(i.props ?? {}).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
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

const nonEmpty = <T>(list: readonly T[]): readonly T[] | undefined =>
  list.length === 0 ? undefined : list;

/**
 * Detailansicht als JSON-Objekt: die Felder des Issues (`depends_on` als Referenzen mit State und
 * Titel), dazu Body, Vorfahren, Abhängige, Sub-Issues, Fortschritt, Kommentare und Hinweise.
 * Leere Listen und ein leerer Body fehlen.
 */
export function issueDetailJson(d: IssueDetail): Record<string, unknown> {
  return {
    ...d.issue,
    depends_on: nonEmpty(d.dependsOn),
    body: d.body === '' ? undefined : d.body,
    parents: nonEmpty(d.parents),
    dependents: nonEmpty(d.dependents),
    children: nonEmpty(d.children),
    progress: d.progress,
    comments_count: d.commentsCount,
    last_reason: d.lastReason,
    comments: nonEmpty(d.comments),
    notices: nonEmpty(d.notices),
  };
}

/** Ein Listeneintrag als JSON: das Issue, `depth` in der Baumansicht, `open_deps` nur wenn wahr. */
export function issueListJson(item: IssueListItem): Record<string, unknown> {
  return {
    ...item.issue,
    depth: item.depth,
    open_deps: item.openDeps ? true : undefined,
  };
}

/** Die Issue-Datei wie auf der Platte, je angefordertem Kommentar ein Trenner und dessen Datei. */
export function issueDetailMd(d: IssueDetail): string {
  return (
    d.raw +
    d.comments.map((c, n) => `\n<!-- comments/${c.file} -->\n${d.rawComments[n] ?? ''}`).join('')
  );
}
