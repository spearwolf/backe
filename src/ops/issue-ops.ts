/**
 * `issue.create` und `issue.edit` (Operationskatalog, backe.md §2.16.4): neue Issues mit
 * Vorgaben und Vererbung vom Parent anlegen, Felder mit Vorbedingung setzen und Listen ändern.
 */
import { BackeError } from '../core/errors.ts';
import { defaultRandomBytes, generateIssueId } from '../core/ids.ts';
import { parseRepoRef } from '../core/names.ts';
import type { Issue, PropValue } from '../core/schemas.ts';
import { deriveRepoName, normalizeRepoUrl } from '../core/url.ts';
import { canonicalBody } from '../store/frontmatter.ts';
import type { Draft } from './draft.ts';
import { sameValue, violation } from './invariants.ts';
import { bodyHash, type OpOf } from './operation.ts';
import { type RankPosition, rankPlacement } from './rank.ts';

/** Belegt: ein Issue im Draft oder ein Issue-Verzeichnis, dessen Datei nicht ladbar war. */
function idTaken(d: Draft, id: string): boolean {
  if (d.findIssue(id) !== undefined) return true;
  return d.snapshot.problems.some((p) => p.kind === 'issue' && p.key === id);
}

function nonEmpty<T>(list: readonly T[]): T[] | undefined {
  return list.length > 0 ? [...list] : undefined;
}

export function issueCreate(d: Draft, op: OpOf<'issue.create'>): OpOf<'issue.create'> {
  const { ctx } = d;
  const s = d.snapshot;
  if (op.id !== undefined && idTaken(d, op.id)) {
    throw violation('id_collision', `Issue ${op.id} existiert bereits`, { ids: [op.id] });
  }
  const id =
    op.id ??
    generateIssueId(s.config.id_prefix, {
      exists: (candidate) => idTaken(d, candidate),
      issueCount: s.issues.size,
      randomBytes: ctx.randomBytes ?? defaultRandomBytes,
    });
  const parent = op.parent === undefined ? undefined : d.issue(op.parent).data;
  // Nur ein fehlendes Feld erbt; `[]` heißt ausdrücklich »keine«.
  const projects = op.projects ?? parent?.projects ?? [];
  const sprints = op.sprints ?? parent?.sprints ?? [];
  const repos = op.repos ?? parent?.repos ?? [];
  const state = op.state ?? 'backlog';
  const created = op.created ?? ctx.now;
  const data: Issue = {
    id,
    title: op.title,
    state,
    blocked_by: op.blocked_by,
    paused_from: op.paused_from,
    parent: op.parent,
    depends_on: op.depends_on,
    rank: op.rank,
    creator: ctx.actor,
    assignee: op.assignee,
    projects: nonEmpty(projects),
    sprints: nonEmpty(sprints),
    repos: nonEmpty(repos),
    created,
    props: op.props,
  };
  d.putIssue(id, data, op.body ?? '');
  return {
    ...op,
    id,
    state,
    created,
    projects: [...projects],
    sprints: [...sprints],
    repos: [...repos],
  };
}

function show(value: unknown): string {
  return value === null ? 'nicht gesetzt' : JSON.stringify(value);
}

/** Ist-Wert ≠ `from` → `precondition`. */
export function expectFrom<T>(id: string, field: string, current: T | null, from: T | null): void {
  if (sameValue(current, from)) return;
  throw violation('precondition', `${id}: ${field} ist ${show(current)}, erwartet ${show(from)}`, {
    ids: [id],
  });
}

/**
 * Vorbedingung eines Setzens: Zielwert schon erreicht → `false` (No-op); Ist-Wert ≠ `from` →
 * `precondition`; sonst `true`.
 */
export function settle<T>(
  id: string,
  field: string,
  current: T | null,
  change: { from: T | null; to: T | null },
): boolean {
  if (sameValue(current, change.to)) return false;
  expectFrom(id, field, current, change.from);
  return true;
}

const LIST_FIELDS = ['projects', 'sprints', 'repos', 'depends_on', 'blocked_by'] as const;

/** Erst entfernen, dann hinten anhängen, was fehlt; eine leere Liste entfällt. */
function editList(
  current: readonly string[] | undefined,
  add: readonly string[] | undefined,
  remove: readonly string[] | undefined,
): string[] | undefined {
  const dropped = new Set(remove ?? []);
  const out = (current ?? []).filter((x) => !dropped.has(x));
  for (const x of add ?? []) if (!out.includes(x)) out.push(x);
  return nonEmpty(out);
}

function editProps(
  id: string,
  current: Readonly<Record<string, PropValue>> | undefined,
  changes: Readonly<Record<string, { from: PropValue | null; to: PropValue | null }>>,
): Record<string, PropValue> | undefined {
  const props: Record<string, PropValue> = { ...current };
  for (const [key, change] of Object.entries(changes)) {
    const value = Object.hasOwn(props, key) ? (props[key] as PropValue) : null;
    if (!settle(id, `props.${key}`, value, change)) continue;
    if (change.to === null) delete props[key];
    else props[key] = change.to;
  }
  return Object.keys(props).length > 0 ? props : undefined;
}

export function issueEdit(d: Draft, op: OpOf<'issue.edit'>): OpOf<'issue.edit'> {
  const current = d.issue(op.id);
  const before = current.data;
  const next: Issue = { ...before };
  const { set } = op;

  if (set?.title !== undefined && settle(op.id, 'title', before.title, set.title)) {
    next.title = set.title.to;
  }
  if (set?.parent !== undefined && settle(op.id, 'parent', before.parent ?? null, set.parent)) {
    next.parent = set.parent.to ?? undefined;
  }
  if (
    set?.assignee !== undefined &&
    settle(op.id, 'assignee', before.assignee ?? null, set.assignee)
  ) {
    next.assignee = set.assignee.to ?? undefined;
  }

  if (op.add?.blocked_by !== undefined || op.remove?.blocked_by !== undefined) {
    if (before.state !== 'blocked') {
      throw violation(
        'transition',
        `${op.id}: blocked_by ist nur im State "blocked" änderbar, State ist "${before.state}"`,
        {
          ids: [op.id],
        },
      );
    }
  }
  for (const field of LIST_FIELDS) {
    const add = op.add?.[field];
    const remove = op.remove?.[field];
    if (add !== undefined || remove !== undefined)
      next[field] = editList(before[field], add, remove);
  }
  if (before.state === 'blocked' && next.blocked_by === undefined) {
    throw violation(
      'transition',
      `${op.id}: ein blockiertes Issue braucht mindestens einen Blocker`,
      {
        ids: [op.id],
        hint: `Zum Aufheben der Blockade: backe issue resume ${op.id}`,
      },
    );
  }

  if (op.props !== undefined) next.props = editProps(op.id, before.props, op.props);

  let body: string | undefined;
  if (op.body !== undefined && current.body !== canonicalBody(op.body.to)) {
    if (bodyHash(current.body) !== op.body.from_hash) {
      throw violation('precondition', `${op.id}: Body wurde inzwischen geändert`, { ids: [op.id] });
    }
    body = op.body.to;
  }

  d.putIssue(op.id, next, body);
  return op;
}

/**
 * `issue.rank` (backe.md §2.22): neue Ranks aus `rankPlacement`. Ändert sich nichts, ist es ein
 * No-op; sonst muss `from` zum aktuellen Rank des Issues passen.
 */
export function issueRank(d: Draft, op: OpOf<'issue.rank'>): OpOf<'issue.rank'> {
  const current = d.issue(op.id).data.rank ?? null;
  const position: RankPosition =
    op.top === true
      ? { top: true }
      : op.bottom === true
        ? { bottom: true }
        : op.before !== undefined
          ? { before: op.before }
          : op.after !== undefined
            ? { after: op.after }
            : { value: op.value as number };
  const placement = rankPlacement(d.snapshot, op.id, position);
  if (placement.size === 0) return op;
  expectFrom(op.id, 'rank', current, op.from);
  for (const [id, rank] of placement) d.putIssue(id, { ...d.issue(id).data, rank });
  return op;
}

/** Kanonische URL eines registrierten Repos; eine nicht normalisierbare gilt als kein Treffer. */
function canonicalOf(url: string): string | undefined {
  try {
    return normalizeRepoUrl(url);
  } catch (err) {
    if (err instanceof BackeError) return undefined;
    throw err;
  }
}

/** Name des Repos mit dieser kanonischen URL; sonst wird es unter abgeleitetem Namen angelegt. */
function repoNameForUrl(d: Draft, url: string): string {
  const canonical = normalizeRepoUrl(url);
  for (const [name, repo] of d.snapshot.repos) {
    if (canonicalOf(repo.data.url) === canonical) return name;
  }
  const name = deriveRepoName(canonical, new Set(d.snapshot.repos.keys()));
  d.putEntity('repo', name, { url });
  return name;
}

/**
 * `issue.link`: ein Eintrag `name[@ref]` ersetzt den vorhandenen mit gleichem Namen an derselben
 * Stelle, sonst wird er angehängt. Mit `url` wird ein unbekanntes Repo implizit registriert
 * (backe.md §2.11).
 */
export function issueLink(d: Draft, op: OpOf<'issue.link'>): OpOf<'issue.link'> {
  const before = d.issue(op.id).data;
  const name = op.url === undefined ? (op.repo as string) : repoNameForUrl(d, op.url);
  const entry = op.ref === undefined ? name : `${name}@${op.ref}`;
  const repos = [...(before.repos ?? [])];
  const index = repos.findIndex((e) => parseRepoRef(e).name === name);
  if (index < 0) repos.push(entry);
  else repos[index] = entry;
  d.putIssue(op.id, { ...before, repos }, undefined);
  return op;
}

/** `issue.unlink`: entfernt den Eintrag mit dem Namen; fehlt er, passiert nichts. */
export function issueUnlink(d: Draft, op: OpOf<'issue.unlink'>): OpOf<'issue.unlink'> {
  const before = d.issue(op.id).data;
  const repos = (before.repos ?? []).filter((e) => parseRepoRef(e).name !== op.repo);
  d.putIssue(op.id, { ...before, repos: nonEmpty(repos) });
  return op;
}
