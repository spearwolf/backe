/**
 * Deterministisches Benchmark-Backlog für `scripts/bench-ui.ts` (Festlegung »Benchmark-Backlog« in
 * `docs/superpowers/plans/2026-11-27-ui-u12-paket-ci-performance.md`): 10 Projekte, 12 Sprints
 * (10 geschlossen, 2 offen) und Issues, deren Felder allein aus ihrem Index folgen.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CROCKFORD } from '../src/core/ids.ts';
import { isSettled, type State } from '../src/core/state.ts';
import { serializeEntityFile } from '../src/store/frontmatter.ts';
import { issueFile, projectFile, sprintFile } from '../src/store/layout.ts';

/** Präfix der IDs; `bench-ui.ts` legt das Backlog mit `--prefix bk` an. */
export const BENCH_PREFIX = 'bk';

/** Elternprojekte vor ihren Kindern: `loadSnapshot` verwirft ein Unterprojekt ohne Eltern. */
export const BENCH_PROJECTS: readonly string[] = [
  'web',
  'web/board',
  'web/list',
  'cli',
  'cli/sync',
  'store',
  'store/git',
  'docs',
  'infra',
  'infra/ci',
];

/** Zehn geschlossene Wochen-Sprints, dann die zwei offenen. */
export const BENCH_SPRINTS: readonly { slug: string; closed: boolean }[] = Array.from(
  { length: 12 },
  (_, k) => ({ slug: `2026-w${String(37 + k).padStart(2, '0')}`, closed: k < 10 }),
);

const CLOSED = BENCH_SPRINTS.filter((s) => s.closed).map((s) => s.slug);
const OPEN = BENCH_SPRINTS.filter((s) => !s.closed).map((s) => s.slug);

/** Anteile in Prozent, kumuliert gegen `(i * 7919) % 100` gelegt. */
const SHARES: readonly (readonly [State, number])[] = [
  ['done', 45],
  ['backlog', 20],
  ['todo', 13],
  ['in_progress', 8],
  ['review', 5],
  ['blocked', 3],
  ['on_hold', 2],
  ['cancelled', 2],
  ['rejected', 2],
];

/**
 * State des Issues `i`. 7919 ist teilerfremd zu 100: Jeder Block aus 100 aufeinanderfolgenden
 * Indizes trifft jeden Rest genau einmal, die Anteile stimmen also exakt bei `n` als Vielfachem
 * von 100 und sind über das Backlog gestreut statt in Blöcken.
 */
function stateOf(i: number): State {
  let slot = (i * 7919) % 100;
  for (const [state, share] of SHARES) {
    if (slot < share) return state;
    slot -= share;
  }
  throw new Error(`Anteile ergeben nicht 100 % (Index ${i})`);
}

/** Deterministische ID: der Index in Basis 32 (Crockford), auf fünf Zeichen aufgefüllt. */
export function benchId(i: number): string {
  let rest = i;
  let tail = '';
  for (let k = 0; k < 5; k++) {
    tail = CROCKFORD[rest % 32] + tail;
    rest = Math.floor(rest / 32);
  }
  return `${BENCH_PREFIX}-${tail}`;
}

/** `created` je Index eine Minute weiter ab dem 1. Juli 2026. */
function createdOf(i: number): string {
  return `${new Date(Date.UTC(2026, 6, 1) + i * 60_000).toISOString().slice(0, 19)}Z`;
}

/** Frontmatter des Issues `i` von `n` nach den Festlegungen (deterministisch). */
export function benchIssue(i: number, n: number): Record<string, unknown> {
  if (!Number.isInteger(i) || i < 0 || i >= n)
    throw new Error(`Index ${i} außerhalb von [0, ${n})`);
  const state = stateOf(i);
  const issue: Record<string, unknown> = {
    id: benchId(i),
    title: `Bench-Issue ${i}`,
    state,
  };
  // Index 0 ist `done` (Rest 0); ein pausiertes Issue hat also immer ein früheres.
  if (state === 'blocked') issue.blocked_by = [benchId(i - 1)];
  if (state === 'blocked' || state === 'on_hold') {
    issue.paused_from = i % 2 === 0 ? 'todo' : 'in_progress';
  }
  if (i > 0 && i % 17 === 0) issue.depends_on = [benchId(Math.floor(i / 2))];
  issue.rank = i * 1000;
  issue.creator = 'spw';
  if (i % 4 === 0) issue.assignee = 'spw';
  issue.projects = [BENCH_PROJECTS[i % BENCH_PROJECTS.length]];
  if (isSettled(state)) issue.sprints = [CLOSED[i % CLOSED.length]];
  else if (i % 3 !== 0) issue.sprints = [OPEN[i % OPEN.length]];
  issue.created = createdOf(i);
  return issue;
}

async function put(root: string, path: string, text: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

/** Schreibt Sprints, Projekte und die Issues `[from, to)` als Dateien in die Arbeitskopie `root`. */
export async function writeBenchFiles(
  root: string,
  n: number,
  from: number,
  to: number,
): Promise<void> {
  for (const [k, { slug, closed }] of BENCH_SPRINTS.entries()) {
    const start = new Date(Date.UTC(2026, 8, 7) + k * 7 * 86_400_000);
    const end = new Date(start.getTime() + 4 * 86_400_000);
    const data: Record<string, unknown> = {
      title: `Sprint ${slug}`,
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
    if (closed) data.closed = true;
    await put(root, sprintFile(slug), serializeEntityFile('sprint', data, ''));
  }
  for (const path of BENCH_PROJECTS) {
    await put(root, projectFile(path), serializeEntityFile('project', { title: path }, ''));
  }
  for (let i = from; i < to; i++) {
    const issue = benchIssue(i, n);
    const body = `Beschreibung von Bench-Issue ${i}.\n`;
    await put(root, issueFile(issue.id as string), serializeEntityFile('issue', issue, body));
  }
}
