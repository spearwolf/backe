/**
 * Hand-Edits als Operationen (backe.md §2.13 »Hand-Edits«): geänderte Dateien (Stand in `HEAD`
 * gegen Arbeitskopie) werden zu Operationen, die sich gegen den `HEAD`-Snapshot anwenden und
 * replayen lassen. Eine Datei wird ganz übersetzt oder ganz als `manual` gemeldet.
 */
import { BackeError } from '../core/errors.ts';
import {
  type Comment,
  type EntityKind,
  type Issue,
  KEY_ORDER,
  type PropValue,
  type Sprint,
  type User,
  validateEntity,
} from '../core/schemas.ts';
import { planTransition } from '../core/state.ts';
import { canonicalBody, entriesInFileOrder, parseEntityFile } from '../store/frontmatter.ts';
import { classifyPath, parseCommentFileName } from '../store/layout.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { sameValue, violation } from './invariants.ts';
import { bodyHash, type Operation, type OpOf } from './operation.ts';

/** Inhalt einer Datei in `HEAD` (`before`) und in der Arbeitskopie (`after`); `null` = fehlt. */
export type EditedFile = { path: string; before: string | null; after: string | null };

export type TranslateResult = {
  ops: Operation[];
  /** Dateien ohne Operations-Entsprechung, nach Pfad sortiert. */
  manual: string[];
  /** Jede Nachher-Datei mit unbekannten Keys, nach Pfad sortiert. */
  warnings: { path: string; unknownKeys: string[] }[];
};

type NamedKind = 'user' | 'project' | 'sprint' | 'repo';

/** Eine Seite einer Entitätsdatei: geprüfte Daten, unbekannte Keys, kanonischer Body. */
type Side<T> = { data: T; extra: [string, unknown][]; body: string };

/** Ops einer Datei; `tier` ordnet innerhalb einer Gruppe vor dem Pfad (kleiner zuerst). */
type Item = { path: string; ops: Operation[]; tier?: number };

const MANUAL = 'manual';
type Outcome = Operation[] | typeof MANUAL;

const LIST_FIELDS = ['projects', 'sprints', 'repos', 'depends_on', 'blocked_by'] as const;
type ListField = (typeof LIST_FIELDS)[number];

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Kopie ohne Keys mit `undefined`, damit die Operation keine leeren Felder trägt. */
function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function read<T>(kind: EntityKind, text: string | null, path: string): Side<T> | undefined {
  if (text === null) return undefined;
  const parsed = parseEntityFile(text, path);
  const { data, unknownKeys } = validateEntity(kind, parsed.data, path);
  return {
    data: data as T,
    extra: entriesInFileOrder(parsed, unknownKeys),
    body: canonicalBody(parsed.body),
  };
}

/** Einträge von `a`, die `b` nicht hat. */
function without(a: readonly string[] | undefined, b: readonly string[] | undefined): string[] {
  const drop = new Set(b ?? []);
  return (a ?? []).filter((x) => !drop.has(x));
}

/** Body-Abschnitt einer Operation, wenn sich der kanonische Body ändert. */
function bodyChange(before: string, after: string): { from_hash: string; to: string } | undefined {
  return before === after ? undefined : { from_hash: bodyHash(before), to: after };
}

// --- Issues --------------------------------------------------------------------------------

function createIssue(
  path: string,
  id: string,
  after: Side<Issue>,
  actor: string,
): OpOf<'issue.create'> | typeof MANUAL {
  const d = after.data;
  if (d.id !== id) {
    throw violation('schema', `${path}: id ${d.id} passt nicht zum Pfad (${id})`, { ids: [id] });
  }
  if (d.creator !== actor) {
    throw violation('policy', `${path}: creator ist ${d.creator}, committen will ${actor}`, {
      ids: [id],
      hint: 'Ein neues Issue gehört dem, der es anlegt; creator auf den eigenen Handle setzen.',
    });
  }
  if (d.attachments !== undefined) return MANUAL;
  // Listen stehen immer da: fehlende würden sonst vom Parent geerbt.
  return defined<OpOf<'issue.create'>>({
    op: 'issue.create',
    id,
    title: d.title,
    state: d.state,
    blocked_by: d.blocked_by,
    paused_from: d.paused_from,
    parent: d.parent,
    depends_on: d.depends_on,
    rank: d.rank,
    assignee: d.assignee,
    projects: d.projects ?? [],
    sprints: d.sprints ?? [],
    repos: d.repos ?? [],
    props: d.props !== undefined && Object.keys(d.props).length > 0 ? d.props : undefined,
    created: d.created,
    body: after.body,
  });
}

function moveIssue(path: string, before: Issue, after: Issue, strict: boolean): OpOf<'issue.move'> {
  const { id } = before;
  const blockedBy = after.state === 'blocked' ? after.blocked_by : undefined;
  const fail = (message: string) =>
    violation('transition', `${path}: ${message}`, {
      ids: [id],
      hint: `Den Zustand mit backe issue move, resume oder reopen ändern (${id}).`,
    });
  let next: ReturnType<typeof planTransition>;
  try {
    next = planTransition(before, 'move', {
      to: after.state,
      strict,
      ...(blockedBy === undefined ? {} : { blockedBy }),
    });
  } catch (err) {
    if (err instanceof BackeError) throw fail(err.message);
    throw err;
  }
  if (next?.paused_from !== after.paused_from || !sameValue(next?.blocked_by, after.blocked_by)) {
    throw fail(
      `paused_from/blocked_by passen nicht zum Übergang ${before.state} -> ${after.state}` +
        ` (erwartet paused_from ${next?.paused_from ?? 'nicht gesetzt'})`,
    );
  }
  return defined({
    op: 'issue.move',
    id,
    from: before.state,
    to: after.state,
    blocked_by: blockedBy,
  });
}

function editIssue(
  before: Side<Issue>,
  after: Side<Issue>,
  moved: boolean,
): OpOf<'issue.edit'> | undefined {
  const b = before.data;
  const a = after.data;
  const set: Record<string, { from: string | null; to: string | null }> = {};
  for (const field of ['title', 'parent', 'assignee'] as const) {
    const from = b[field] ?? null;
    const to = a[field] ?? null;
    if (from !== to) set[field] = { from, to };
  }
  const add: Partial<Record<ListField, string[]>> = {};
  const remove: Partial<Record<ListField, string[]>> = {};
  // Mit einem Zustandswechsel kommt `blocked_by` aus `issue.move`.
  for (const field of LIST_FIELDS.filter((f) => !(moved && f === 'blocked_by'))) {
    const plus = without(a[field], b[field]);
    const minus = without(b[field], a[field]);
    if (plus.length > 0) add[field] = plus;
    if (minus.length > 0) remove[field] = minus;
  }
  const props: Record<string, { from: PropValue | null; to: PropValue | null }> = {};
  const old = b.props ?? {};
  const now = a.props ?? {};
  for (const key of new Set([...Object.keys(old), ...Object.keys(now)])) {
    const from = Object.hasOwn(old, key) ? (old[key] as PropValue) : null;
    const to = Object.hasOwn(now, key) ? (now[key] as PropValue) : null;
    if (!sameValue(from, to)) props[key] = { from, to };
  }
  const sections = defined({
    set: Object.keys(set).length > 0 ? set : undefined,
    add: Object.keys(add).length > 0 ? add : undefined,
    remove: Object.keys(remove).length > 0 ? remove : undefined,
    props: Object.keys(props).length > 0 ? props : undefined,
    body: bodyChange(before.body, after.body),
  });
  if (Object.keys(sections).length === 0) return undefined;
  return { op: 'issue.edit', id: b.id, ...sections } as OpOf<'issue.edit'>;
}

/** Reihenfolge je Issue: `issue.move` → `issue.edit` → `issue.rank`. */
function changeIssue(
  path: string,
  before: Side<Issue>,
  after: Side<Issue>,
  strict: boolean,
  extraChanged: boolean,
): Outcome {
  const b = before.data;
  const a = after.data;
  for (const field of ['id', 'created', 'creator'] as const) {
    if (b[field] !== a[field]) {
      throw violation(
        'policy',
        `${path}: ${field} ist nicht änderbar (${b[field]} -> ${a[field]})`,
        {
          ids: [b.id],
        },
      );
    }
  }
  const moved = b.state !== a.state;
  if (!moved && b.paused_from !== a.paused_from) {
    throw violation('transition', `${path}: paused_from ändert sich nur mit dem Zustand`, {
      ids: [b.id],
      hint: `backe issue move ${b.id} oder backe issue resume ${b.id}`,
    });
  }
  // Ein entfernter Rank und geänderte Anhänge haben keine Operation.
  if (extraChanged || !sameValue(b.attachments, a.attachments)) return MANUAL;
  if (b.rank !== undefined && a.rank === undefined) return MANUAL;

  const ops: Operation[] = [];
  if (moved) ops.push(moveIssue(path, b, a, strict));
  const edit = editIssue(before, after, moved);
  if (edit !== undefined) ops.push(edit);
  if (a.rank !== undefined && b.rank !== a.rank) {
    ops.push({ op: 'issue.rank', id: b.id, from: b.rank ?? null, value: a.rank });
  }
  return ops;
}

// --- Kommentare ----------------------------------------------------------------------------

function commentOps(
  path: string,
  id: string,
  file: string,
  before: Side<Comment> | undefined,
  after: Side<Comment> | undefined,
  actor: string,
  extraChanged: boolean,
): Outcome {
  if (after === undefined) return [{ op: 'comment.delete', id, file }];
  if (before === undefined) {
    const name = parseCommentFileName(file);
    if (name?.author !== actor || after.data.author !== actor) {
      throw violation('policy', `${path}: ein neuer Kommentar muss von ${actor} sein`, {
        ids: [id],
      });
    }
    if (after.data.created !== name.created) {
      throw violation('policy', `${path}: created ${after.data.created} passt nicht zum Namen`, {
        ids: [id],
      });
    }
    if (after.data.kind === 'transition') {
      throw violation(
        'transition',
        `${path}: Transition-Kommentare entstehen nur mit dem Übergang`,
        {
          ids: [id],
          hint: 'Den Zustand mit backe issue move ändern; ein Grund wird dabei zum Kommentar.',
        },
      );
    }
    if (extraChanged) return MANUAL;
    return [{ op: 'comment.add', id, file, body: after.body }];
  }
  if (extraChanged || !sameValue(before.data, after.data)) return MANUAL;
  if (before.body === after.body) return [];
  return [{ op: 'comment.edit', id, file, from_hash: bodyHash(before.body), body: after.body }];
}

// --- Projekte, Sprints, Repos, Users -------------------------------------------------------

function bodyField(body: string): { body?: string } {
  return body === '' ? {} : { body };
}

function createEntity(kind: NamedKind, key: string, after: Side<object>): Operation[] {
  const body = bodyField(after.body);
  switch (kind) {
    case 'user': {
      const u = after.data as User;
      const ops: Operation[] = [
        defined({
          op: 'user.add',
          handle: key,
          name: u.name,
          kind: u.kind,
          keys: u.keys,
          operator: u.operator,
          ...body,
        }),
      ];
      if (u.revoked_keys !== undefined) {
        ops.push({
          op: 'entity.edit',
          kind: 'user',
          key,
          set: { revoked_keys: { from: null, to: u.revoked_keys } },
        });
      }
      return ops;
    }
    case 'project': {
      const { title, lead } = after.data as { title: string; lead?: string };
      return [defined({ op: 'project.create', path: key, title, lead, ...body })];
    }
    case 'sprint': {
      const sp = after.data as Sprint;
      const ops: Operation[] = [
        defined({
          op: 'sprint.create',
          slug: key,
          title: sp.title,
          start: sp.start,
          end: sp.end,
          ...body,
        }),
      ];
      if (sp.closed !== undefined) {
        ops.push({
          op: 'entity.edit',
          kind: 'sprint',
          key,
          set: { closed: { from: null, to: sp.closed } },
        });
      }
      return ops;
    }
    case 'repo': {
      const { url, default_ref } = after.data as { url: string; default_ref?: string };
      return [defined({ op: 'repo.add', url, name: key, default_ref, ...body })];
    }
  }
}

function editEntity(
  kind: NamedKind,
  key: string,
  before: Side<object>,
  after: Side<object>,
): Operation[] {
  const b = before.data as Record<string, unknown>;
  const a = after.data as Record<string, unknown>;
  const set: Record<string, { from: PropValue | null; to: PropValue | null }> = {};
  for (const field of KEY_ORDER[kind]) {
    const from = (b[field] ?? null) as PropValue | null;
    const to = (a[field] ?? null) as PropValue | null;
    if (!sameValue(from, to)) set[field] = { from, to };
  }
  const sections = defined({
    set: Object.keys(set).length > 0 ? set : undefined,
    body: bodyChange(before.body, after.body),
  });
  if (Object.keys(sections).length === 0) return [];
  return [{ op: 'entity.edit', kind, key, ...sections }];
}

function removeEntity(kind: NamedKind, key: string): Outcome {
  switch (kind) {
    case 'user':
      return [{ op: 'user.rm', handle: key }];
    case 'project':
      return [{ op: 'project.rm', path: key }];
    case 'repo':
      return [{ op: 'repo.rm', name: key }];
    case 'sprint':
      // Für Sprints gibt es keine Lösch-Operation.
      return MANUAL;
  }
}

// --- Reihenfolge ---------------------------------------------------------------------------

/**
 * Topologische Reihenfolge (Kahn, iterativ): `prerequisites(id)` nennt, was vor `id` stehen muss;
 * nur IDs aus `ids` zählen. Bei Gleichstand die kleinste ID zuerst. `stuck` sind die IDs, die in
 * einem Zyklus hängen, sortiert.
 */
function topoOrder(
  ids: readonly string[],
  prerequisites: (id: string) => readonly string[],
): { order: string[]; stuck: string[] } {
  const members = new Set(ids);
  const pending = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of ids) {
    const pre = [...new Set(prerequisites(id))].filter((p) => members.has(p) && p !== id);
    pending.set(id, pre.length);
    for (const p of pre) dependents.set(p, [...(dependents.get(p) ?? []), id]);
  }
  const ready = ids.filter((id) => pending.get(id) === 0).sort(compare);
  const order: string[] = [];
  for (let id = ready.shift(); id !== undefined; id = ready.shift()) {
    order.push(id);
    for (const dep of dependents.get(id) ?? []) {
      const left = (pending.get(dep) as number) - 1;
      pending.set(dep, left);
      if (left === 0) {
        ready.push(dep);
        ready.sort(compare);
      }
    }
  }
  const done = new Set(order);
  return { order, stuck: ids.filter((id) => !done.has(id)).sort(compare) };
}

/** Neue Issues so, dass `parent`, `depends_on` und `blocked_by` unter ihnen vorher entstehen. */
function orderCreates(creates: ReadonlyMap<string, OpOf<'issue.create'>>): Operation[] {
  const { order, stuck } = topoOrder([...creates.keys()], (id) => {
    const op = creates.get(id) as OpOf<'issue.create'>;
    return [
      ...(op.parent === undefined ? [] : [op.parent]),
      ...(op.depends_on ?? []),
      ...(op.blocked_by ?? []),
    ];
  });
  if (stuck.length > 0) {
    throw violation('cycle', `Neue Issues verweisen zyklisch aufeinander: ${stuck.join(', ')}`, {
      ids: stuck,
      hint: 'Erst einen Teil der Issues committen, dann die Verweise ergänzen.',
    });
  }
  return order.map((id) => creates.get(id) as Operation);
}

/**
 * IDs aus `parents` (je Issue seine Parents vorher und nachher), Sub-Issues vor ihrem Parent; was
 * in einem Parent-Zyklus hängt, zuletzt.
 */
function childrenFirst(parents: ReadonlyMap<string, readonly (string | undefined)[]>): string[] {
  const children = new Map<string, string[]>();
  for (const [id, list] of parents) {
    for (const parent of new Set(list)) {
      if (parent !== undefined) children.set(parent, [...(children.get(parent) ?? []), id]);
    }
  }
  const { order, stuck } = topoOrder([...parents.keys()], (id) => children.get(id) ?? []);
  return [...order, ...stuck];
}

/** Gelöschte Issues, Sub-Issues vor ihrem Parent (sonst scheitert der Parent an `has_children`). */
function orderDeletes(deleted: ReadonlyMap<string, Issue>): Operation[] {
  const parents = new Map([...deleted].map(([id, issue]) => [id, [issue.parent]]));
  return childrenFirst(parents).map((id): Operation => ({ op: 'issue.delete', id, force: true }));
}

const byPath = (a: Item, b: Item) => compare(a.path, b.path);
const depth = (path: string) => path.split('/').length;

const byTier = (a: Item, b: Item) => (a.tier ?? 0) - (b.tier ?? 0) || byPath(a, b);

/**
 * Rang einer User-Datei, damit jeder User vor den Ops steht, die ihn als `operator` nennen: neue
 * Menschen, dann neue Agents, dann Änderungen. Beim Löschen Agents vor den übrigen, weil
 * `user.rm` den Operator eines noch vorhandenen Agents ablehnt.
 */
function userTier(before: User | undefined, after: User | undefined): number {
  if (after === undefined) return before?.kind === 'agent' ? 0 : 1;
  if (before !== undefined) return 2;
  return after.kind === 'agent' ? 1 : 0;
}

// --- Übersetzung ---------------------------------------------------------------------------

/**
 * Übersetzt Hand-Edits in Operationen gegen `s`, den Stand von `HEAD`. Jede Nachher-Datei wird
 * geparst und geprüft; Fehler tragen `datei:zeile`. Jeder Pfad darf nur einmal vorkommen.
 * Reihenfolge der Operationen: Users (neue Menschen, neue Agents, Änderungen) → Projekte (flach
 * vor tief) → Sprints → Repos → neue Issues (topologisch) → Issue-Änderungen (Sub-Issues vor dem
 * Parent) → Kommentare → gelöschte Issues (Sub-Issues vor dem Parent) → gelöschte Repos,
 * Projekte (tief vor flach), Users (Agents zuerst).
 */
export function translateEdits(
  s: BacklogSnapshot,
  files: readonly EditedFile[],
  ctx: { actor: string },
): TranslateResult {
  const { actor } = ctx;
  const strict = s.config.workflow.strict;
  const manual: string[] = [];
  const warnings: TranslateResult['warnings'] = [];
  const named: Record<NamedKind, Item[]> = { user: [], project: [], sprint: [], repo: [] };
  const removed: Record<NamedKind, Item[]> = { user: [], project: [], sprint: [], repo: [] };
  const creates = new Map<string, OpOf<'issue.create'>>();
  /** Geänderte Issues: Ops und die Parents vorher und nachher, für die Reihenfolge. */
  const changes = new Map<string, { ops: Operation[]; parents: (string | undefined)[] }>();
  const comments: Item[] = [];
  const deletes = new Map<string, Issue>();

  // Kommentare und Anhänge eines gelöschten Issues verschwinden mit seinem Verzeichnis.
  const deletedIssues = new Set<string>();
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.path)) {
      throw new BackeError('usage', `${f.path} steht mehrfach in den Hand-Edits`);
    }
    seen.add(f.path);
    const cls = classifyPath(f.path);
    if (cls.kind === 'issue' && f.before !== null && f.after === null) deletedIssues.add(cls.id);
  }

  for (const f of files) {
    const { path } = f;
    if (f.before === null && f.after === null) continue;
    const cls = classifyPath(path);
    if ((cls.kind === 'comment' || cls.kind === 'attachment') && deletedIssues.has(cls.id)) {
      if (f.after === null || f.before === f.after) continue;
      // Sonst landete der neue Inhalt im Commit und `issue.delete` entfernte ihn gleich wieder.
      const label = cls.kind === 'comment' ? 'Kommentar' : 'Anhang';
      throw new BackeError(
        'usage',
        `${path}: ${label} unter ${cls.id}, das im selben Edit gelöscht wird, ginge verloren`,
        { hint: `Den ${label} verwerfen oder ${cls.id} nicht löschen.` },
      );
    }
    if (cls.kind === 'config' || cls.kind === 'other' || cls.kind === 'attachment') {
      if (f.before !== f.after) manual.push(path);
      continue;
    }

    const kind = cls.kind;
    const before = read<object>(kind, f.before, path);
    const after = read<object>(kind, f.after, path);
    if (after !== undefined && after.extra.length > 0) {
      warnings.push({ path, unknownKeys: after.extra.map(([k]) => k) });
    }
    const extraChanged = after !== undefined && !sameValue(before?.extra ?? [], after.extra);

    let outcome: Outcome;
    let bucket: Item[];
    let tier: number | undefined;
    switch (kind) {
      case 'issue': {
        const b = before as Side<Issue> | undefined;
        const a = after as Side<Issue> | undefined;
        if (a === undefined) {
          deletes.set(cls.id, (b as Side<Issue>).data);
          continue;
        }
        if (b === undefined) {
          const op = createIssue(path, cls.id, a, actor);
          if (op === MANUAL || extraChanged) manual.push(path);
          else creates.set(cls.id, op);
          continue;
        }
        const result = changeIssue(path, b, a, strict, extraChanged);
        if (result === MANUAL) manual.push(path);
        else changes.set(cls.id, { ops: result, parents: [b.data.parent, a.data.parent] });
        continue;
      }
      case 'comment':
        outcome = commentOps(
          path,
          cls.id,
          cls.file,
          before as Side<Comment> | undefined,
          after as Side<Comment> | undefined,
          actor,
          extraChanged,
        );
        bucket = comments;
        break;
      default: {
        const key = (cls as { key: string }).key;
        if (kind === 'user') {
          tier = userTier(before?.data as User | undefined, after?.data as User | undefined);
        }
        if (after === undefined) {
          outcome = removeEntity(kind, key);
          bucket = removed[kind];
        } else {
          outcome = extraChanged
            ? MANUAL
            : before === undefined
              ? createEntity(kind, key, after)
              : editEntity(kind, key, before, after);
          bucket = named[kind];
        }
      }
    }
    if (outcome === MANUAL) manual.push(path);
    else bucket.push({ path, ops: outcome, tier });
  }

  const flat = (items: Item[]) => items.flatMap((i) => i.ops);
  const flatFirst = (a: Item, b: Item) => depth(a.path) - depth(b.path) || byPath(a, b);
  const deepFirst = (a: Item, b: Item) => depth(b.path) - depth(a.path) || byPath(a, b);
  const parentsOf = new Map([...changes].map(([id, c]) => [id, c.parents]));
  const ops: Operation[] = [
    ...flat(named.user.sort(byTier)),
    ...flat(named.project.sort(flatFirst)),
    ...flat(named.sprint.sort(byPath)),
    ...flat(named.repo.sort(byPath)),
    ...orderCreates(creates),
    // Sub-Issues vor ihrem Parent: Ein Parent auf `done` scheitert sonst an offenen Sub-Issues.
    ...childrenFirst(parentsOf).flatMap((id) => (changes.get(id) as { ops: Operation[] }).ops),
    ...flat(comments.sort(byPath)),
    ...orderDeletes(deletes),
    ...flat(removed.repo.sort(byPath)),
    ...flat(removed.project.sort(deepFirst)),
    ...flat(removed.user.sort(byTier)),
  ];
  return {
    ops,
    manual: manual.sort(compare),
    warnings: warnings.sort((a, b) => compare(a.path, b.path)),
  };
}
