/**
 * Suche über den Clientzustand (ui.md §2.12): ein vorgefalteter Index je Store, daraus gruppierte
 * Treffer. Rein und ohne Regex auf Nutzereingaben, damit keine Anfrage werfen oder hängen kann.
 */
import { compareCodeUnits } from '@backe/core/compare.ts';
import { isSettled } from '@backe/core/state.ts';
import { compareIssues } from '@backe/ops/order.ts';
import type { IssueJson, ProjectJson, RepoJson, SprintJson, UserJson } from '@backe/ui/api.ts';
import { createMemo, type SignalReader } from '@spearwolf/signalize';
import type { Store } from '../data/store.ts';

export const SEARCH_LIMIT = 8;
/** Kürzeste Kurzform einer Issue-ID (Zufallsteil), die als ID-Treffer zählt. */
export const SHORT_ID_MIN = 3;

/** Score eines ID-Treffers: über jedem Titeltreffer (höchstens 4 je Token). */
const ID_SCORE = 5;

/** NFKD, ohne Kombinationszeichen, klein. */
export function fold(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

type Entry<T> = {
  item: T;
  /** Gefaltete Felder, in denen ein Token als Teilstring vorkommen darf. */
  fields: string[];
  /** Wörter aller Felder. */
  words: string[];
};

type IssueEntry = Entry<IssueJson> & { id: string; random: string };

export type SearchIndex = {
  issues: IssueEntry[];
  projects: Entry<ProjectJson>[];
  sprints: Entry<SprintJson>[];
  repos: Entry<RepoJson>[];
  users: Entry<UserJson>[];
};

function wordsOf(field: string): string[] {
  return field.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');
}

function entry<T>(item: T, raw: readonly string[]): Entry<T> {
  const fields = raw.map(fold);
  return { item, fields, words: fields.flatMap(wordsOf) };
}

export function buildSearchIndex(input: {
  issues: readonly IssueJson[];
  projects: readonly ProjectJson[];
  sprints: readonly SprintJson[];
  repos: readonly RepoJson[];
  users: readonly UserJson[];
}): SearchIndex {
  return {
    issues: input.issues.map((issue) => {
      const id = fold(issue.id);
      return { ...entry(issue, [issue.title]), id, random: id.slice(id.indexOf('-') + 1) };
    }),
    projects: input.projects.map((p) => entry(p, [p.path, p.title])),
    sprints: input.sprints.map((s) => entry(s, [s.slug, s.title])),
    repos: input.repos.map((r) => entry(r, [r.name, r.url])),
    users: input.users.map((u) => entry(u, [u.handle, u.name])),
  };
}

/** Memo je Store; rechnet neu bei jeder Entitätsänderung (die Tabellen-`list()`s sind getrackt). */
const indexes = new WeakMap<Store, SignalReader<SearchIndex>>();

export function searchIndexOf(store: Store): SignalReader<SearchIndex> {
  let reader = indexes.get(store);
  if (reader === undefined) {
    reader = createMemo(
      () =>
        buildSearchIndex({
          issues: store.issues.list(),
          projects: store.projects.list(),
          sprints: store.sprints.list(),
          repos: store.repos.list(),
          users: store.users.list(),
        }),
      { attach: store },
    );
    indexes.set(store, reader);
  }
  return reader;
}

/** Damerau-Levenshtein-Abstand höchstens 1 (Einfügen, Löschen, Ersetzen, Vertauschen), O(n). */
function withinOneEdit(a: string, b: string): boolean {
  const diff = a.length - b.length;
  if (diff > 1 || diff < -1) return false;
  let i = 0;
  const min = Math.min(a.length, b.length);
  while (i < min && a[i] === b[i]) i++;
  if (i === min) return true; // gleich oder ein Zeichen am Ende zu viel
  const restA = a.slice(i + 1);
  const restB = b.slice(i + 1);
  if (diff === 0) {
    // Ersetzen, oder Vertauschen zweier benachbarter Zeichen.
    return (
      restA === restB ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
    );
  }
  // Das längere Wort verliert das Zeichen an Position i.
  return diff > 0 ? restA === b.slice(i) : a.slice(i) === restB;
}

const FUZZY_MIN = 4;

function scoreToken(token: string, e: Entry<unknown>): number {
  let best = 0;
  for (const word of e.words) {
    if (word === token) return 4;
    if (word.startsWith(token)) best = Math.max(best, 3);
  }
  if (best >= 3) return best;
  if (e.fields.some((f) => f.includes(token))) return 2;
  if (token.length >= FUZZY_MIN) {
    for (const word of e.words) {
      if (withinOneEdit(token, word) || withinOneEdit(token, word.slice(0, token.length))) return 1;
    }
  }
  return 0;
}

function scoreEntry(tokens: readonly string[], e: Entry<unknown>): number {
  let sum = 0;
  for (const token of tokens) {
    const s = scoreToken(token, e);
    if (s === 0) return 0;
    sum += s;
  }
  return sum;
}

export type SearchHit =
  | { kind: 'issue'; issue: IssueJson; exact: boolean }
  | { kind: 'project'; project: ProjectJson }
  | { kind: 'sprint'; sprint: SprintJson }
  | { kind: 'repo'; repo: RepoJson }
  | { kind: 'user'; user: UserJson };
export type SearchGroupKind = 'issue' | 'project' | 'sprint' | 'repo' | 'user';
export type SearchGroup = { kind: SearchGroupKind; hits: SearchHit[]; more: number };

/** Kurzform der Anfrage als Zufallsteil einer ID, oder `undefined`, wenn sie keine sein kann. */
function shortFormOf(compact: string, prefix: string | undefined): string | undefined {
  const dash = compact.indexOf('-');
  let rest = compact;
  if (dash >= 0 && prefix !== undefined) {
    if (compact.slice(0, dash) !== fold(prefix)) return undefined;
    rest = compact.slice(dash + 1);
  }
  return rest.length >= SHORT_ID_MIN ? rest : undefined;
}

/** Offene vor erledigten, dann die Backlog-Reihenfolge. */
function openFirst(a: IssueJson, b: IssueJson): number {
  return Number(isSettled(a.state)) - Number(isSettled(b.state)) || compareIssues(a, b);
}

type Scored<T> = { item: T; score: number; exact: boolean };

function byScore<T>(a: Scored<T>, b: Scored<T>): number {
  return Number(b.exact) - Number(a.exact) || b.score - a.score;
}

function group<T>(
  kind: SearchGroupKind,
  scored: Scored<T>[],
  order: (a: T, b: T) => number,
  hit: (s: Scored<T>) => SearchHit,
): SearchGroup | undefined {
  if (scored.length === 0) return undefined;
  scored.sort((a, b) => byScore(a, b) || order(a.item, b.item));
  return {
    kind,
    hits: scored.slice(0, SEARCH_LIMIT).map(hit),
    more: Math.max(0, scored.length - SEARCH_LIMIT),
  };
}

function scoreAll<T>(entries: readonly Entry<T>[], tokens: readonly string[]): Scored<T>[] {
  const out: Scored<T>[] = [];
  for (const e of entries) {
    const score = scoreEntry(tokens, e);
    if (score > 0) out.push({ item: e.item, score, exact: false });
  }
  return out;
}

/** Nur nicht leere Gruppen, in fester Reihenfolge; leere Anfrage → []. */
export function searchStore(
  index: SearchIndex,
  query: string,
  prefix: string | undefined,
): SearchGroup[] {
  const folded = fold(query);
  const tokens = folded.split(/\s+/).filter((t) => t !== '');
  if (tokens.length === 0) return [];
  const compact = tokens.join('');
  const short = shortFormOf(compact, prefix);

  const issues: Scored<IssueJson>[] = [];
  for (const e of index.issues) {
    const exact = e.id === compact || (short !== undefined && e.random === short);
    const idScore = exact || (short !== undefined && e.random.startsWith(short)) ? ID_SCORE : 0;
    const score = Math.max(idScore, scoreEntry(tokens, e));
    if (score > 0) issues.push({ item: e.item, score, exact });
  }

  const groups = [
    group('issue', issues, openFirst, (s) => ({ kind: 'issue', issue: s.item, exact: s.exact })),
    group(
      'project',
      scoreAll(index.projects, tokens),
      (a, b) => compareCodeUnits(a.path, b.path),
      (s) => ({
        kind: 'project',
        project: s.item,
      }),
    ),
    group(
      'sprint',
      scoreAll(index.sprints, tokens),
      (a, b) => compareCodeUnits(a.slug, b.slug),
      (s) => ({
        kind: 'sprint',
        sprint: s.item,
      }),
    ),
    group(
      'repo',
      scoreAll(index.repos, tokens),
      (a, b) => compareCodeUnits(a.name, b.name),
      (s) => ({
        kind: 'repo',
        repo: s.item,
      }),
    ),
    group(
      'user',
      scoreAll(index.users, tokens),
      (a, b) => compareCodeUnits(a.handle, b.handle),
      (s) => ({
        kind: 'user',
        user: s.item,
      }),
    ),
  ];
  return groups.filter((g): g is SearchGroup => g !== undefined);
}
