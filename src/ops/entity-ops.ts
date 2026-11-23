/**
 * Projekte, Sprints, Repos und Users sowie `entity.edit` (Operationskatalog, backe.md §2.9 bis
 * §2.12): anlegen, verschieben, entfernen und Felder mit Vorbedingung ändern. Verweise von Issues
 * darauf bleiben dabei gültig oder die Operation wird abgelehnt.
 */

import { isProjectPath, parseRepoRef, projectAncestors } from '../core/names.ts';
import type { Issue, Project, User } from '../core/schemas.ts';
import { isSettled } from '../core/state.ts';
import { deriveRepoName, normalizeRepoUrl } from '../core/url.ts';
import { canonicalBody } from '../store/frontmatter.ts';
import type { Draft, NamedKind } from './draft.ts';
import { m } from './entity-ops.messages.ts';
import { sameValue, violation } from './invariants.ts';
import { canonicalOf, settle } from './issue-ops.ts';
import { bodyHash, type OpOf } from './operation.ts';
import { checkUserChange } from './policy.ts';

function inSubtree(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** Liste ohne Duplikate, Reihenfolge des ersten Auftretens; leer → `undefined`. */
function uniqueList(list: readonly string[]): string[] | undefined {
  const out = [...new Set(list)];
  return out.length > 0 ? out : undefined;
}

function requireUser(d: Draft, handle: string): void {
  if (d.findEntity('user', handle) === undefined) {
    throw violation('missing_ref', m.userNotFound(handle), { ids: [handle] });
  }
}

function requireParent(d: Draft, path: string): void {
  const parent = projectAncestors(path).at(-1);
  if (parent !== undefined && d.findEntity('project', parent) === undefined) {
    throw violation('missing_ref', m.parentProjectNotFound(parent), { ids: [parent] });
  }
}

// --- Projekte ------------------------------------------------------------------------------

export function projectCreate(d: Draft, op: OpOf<'project.create'>): OpOf<'project.create'> {
  if (!isProjectPath(op.path)) {
    throw violation('schema', m.invalidProjectPath(op.path), {
      hint: m.invalidProjectPathHint,
    });
  }
  requireParent(d, op.path);
  if (d.findEntity('project', op.path) !== undefined) {
    throw violation('exists', m.projectExists(op.path), { ids: [op.path] });
  }
  if (op.lead !== undefined) requireUser(d, op.lead);
  d.putEntity('project', op.path, { title: op.title, lead: op.lead }, op.body ?? '');
  return op;
}

/**
 * Schreibt `projects` aller Issues um, die einen Eintrag haben, den `mapping` ändert; `undefined`
 * als Ergebnis entfernt den Eintrag. Reihenfolge bleibt, Duplikate entfallen.
 */
function rewriteIssueProjects(d: Draft, mapping: (path: string) => string | undefined): void {
  const rewrites: [string, Issue][] = [];
  for (const [id, { data }] of d.snapshot.issues) {
    const list = data.projects ?? [];
    if (!list.some((p) => mapping(p) !== p)) continue;
    rewrites.push([id, { ...data, projects: uniqueList(list.flatMap((p) => mapping(p) ?? [])) }]);
  }
  for (const [id, next] of rewrites) d.putIssue(id, next);
}

export function projectMv(d: Draft, op: OpOf<'project.mv'>): OpOf<'project.mv'> {
  const { from, to } = op;
  d.entity('project', from);
  if (!isProjectPath(to)) {
    throw violation('schema', m.invalidProjectPath(to));
  }
  if (inSubtree(to, from)) {
    throw violation('schema', m.cannotMove(from, to), {
      hint: m.cannotMoveHint,
    });
  }
  if (d.findEntity('project', to) !== undefined) {
    throw violation('exists', m.projectExists(to), { ids: [to] });
  }
  requireParent(d, to);
  // Eine kaputte Datei im Teilbaum fehlt in den Maps und bliebe beim Verschieben zurück.
  const unreadable = d.snapshot.problems.find(
    (p) => p.kind === 'project' && p.key !== undefined && inSubtree(p.key, from),
  );
  if (unreadable !== undefined) {
    throw violation('schema', m.projectUnreadable(unreadable.key as string, unreadable.message), {
      hint: m.projectUnreadableHint,
    });
  }

  const moved = [...d.snapshot.projects.keys()].filter((p) => inSubtree(p, from));
  const newPath = (p: string) => `${to}${p.slice(from.length)}`;
  for (const p of moved) {
    if (!isProjectPath(newPath(p))) {
      throw violation('schema', m.pathTooDeep(p, newPath(p)));
    }
    if (d.findEntity('project', newPath(p)) !== undefined) {
      throw violation('exists', m.projectExists(newPath(p)), { ids: [newPath(p)] });
    }
  }
  // Projekte vor Issues: Die Referenzprüfung der Issues sieht sonst den neuen Pfad nicht.
  for (const p of moved) {
    const { data, body, extra } = d.entity('project', p);
    d.putEntity('project', newPath(p), data, body, extra);
  }
  rewriteIssueProjects(d, (p) => (inSubtree(p, from) ? newPath(p) : p));
  for (const p of moved) d.removeEntity('project', p);
  return op;
}

export function projectRm(d: Draft, op: OpOf<'project.rm'>): OpOf<'project.rm'> {
  const { path } = op;
  d.entity('project', path);
  const subprojects = [...d.snapshot.projects.keys()].filter((p) => p.startsWith(`${path}/`));
  if (subprojects.length > 0) {
    throw violation('has_subprojects', m.hasSubprojects(path, subprojects.join(', ')), {
      ids: subprojects,
      hint: m.hasSubprojectsHint,
    });
  }
  if (op.reassign !== undefined) {
    if (op.reassign === path) {
      throw violation('schema', m.cannotReassignToSelf(path));
    }
    d.entity('project', op.reassign);
  }
  const referencing = [...d.snapshot.issues]
    .filter(([, { data }]) => (data.projects ?? []).includes(path))
    .map(([id]) => id);
  if (referencing.length > 0 && op.reassign === undefined && op.detach !== true) {
    throw violation('references', m.projectStillReferenced(path, referencing.join(', ')), {
      ids: referencing,
      hint: m.projectStillReferencedHint,
    });
  }
  rewriteIssueProjects(d, (p) => (p === path ? op.reassign : p));
  d.removeEntity('project', path);
  return op;
}

// --- Sprints -------------------------------------------------------------------------------

export function sprintCreate(d: Draft, op: OpOf<'sprint.create'>): OpOf<'sprint.create'> {
  if (d.findEntity('sprint', op.slug) !== undefined) {
    throw violation('exists', m.sprintExists(op.slug), { ids: [op.slug] });
  }
  d.putEntity('sprint', op.slug, { title: op.title, start: op.start, end: op.end }, op.body ?? '');
  return op;
}

export function sprintClose(d: Draft, op: OpOf<'sprint.close'>): OpOf<'sprint.close'> {
  const sprint = d.entity('sprint', op.slug).data;
  const target = op.carry_over;
  if (target !== undefined) {
    if (target === op.slug) {
      throw violation('schema', m.sprintCarryOverToSelf(op.slug));
    }
    d.entity('sprint', target);
  }
  if (sprint.closed !== true) d.putEntity('sprint', op.slug, { ...sprint, closed: true });
  if (target === undefined) return op;
  const carried: [string, Issue][] = [];
  for (const [id, { data }] of d.snapshot.issues) {
    const sprints = data.sprints ?? [];
    if (!sprints.includes(op.slug) || sprints.includes(target) || isSettled(data.state)) continue;
    carried.push([id, { ...data, sprints: [...sprints, target] }]);
  }
  for (const [id, next] of carried) d.putIssue(id, next);
  return op;
}

// --- Repos ---------------------------------------------------------------------------------

export function repoAdd(d: Draft, op: OpOf<'repo.add'>): OpOf<'repo.add'> {
  const canonical = normalizeRepoUrl(op.url);
  for (const [name, repo] of d.snapshot.repos) {
    if (canonicalOf(repo.data.url) === canonical) {
      throw violation('exists', m.urlAlreadyRegistered(name), { ids: [name] });
    }
  }
  if (op.name !== undefined && d.findEntity('repo', op.name) !== undefined) {
    throw violation('exists', m.repoExists(op.name), { ids: [op.name] });
  }
  // Ein abgeleiteter Name meidet auch Repos, deren Datei nicht ladbar war.
  const taken = new Set(d.snapshot.repos.keys());
  for (const p of d.snapshot.problems)
    if (p.kind === 'repo' && p.key !== undefined) taken.add(p.key);
  const name = op.name ?? deriveRepoName(canonical, taken);
  d.putEntity('repo', name, { url: op.url, default_ref: op.default_ref }, op.body ?? '');
  return { ...op, name };
}

export function repoRm(d: Draft, op: OpOf<'repo.rm'>): OpOf<'repo.rm'> {
  d.entity('repo', op.name);
  const referencing = [...d.snapshot.issues]
    .filter(([, { data }]) => (data.repos ?? []).some((e) => parseRepoRef(e).name === op.name))
    .map(([id]) => id);
  if (referencing.length > 0) {
    throw violation('references', m.repoStillReferenced(op.name, referencing.join(', ')), {
      ids: referencing,
      hint: m.repoStillReferencedHint,
    });
  }
  d.removeEntity('repo', op.name);
  return op;
}

// --- Users ---------------------------------------------------------------------------------

export function userAdd(d: Draft, op: OpOf<'user.add'>): OpOf<'user.add'> {
  if (d.findEntity('user', op.handle) !== undefined) {
    throw violation('exists', m.userExists(op.handle), { ids: [op.handle] });
  }
  const user: User = { name: op.name, kind: op.kind, operator: op.operator, keys: [...op.keys] };
  d.putEntity('user', op.handle, user, op.body ?? '');
  checkUserChange(d.snapshot, d.ctx.actor, op.handle, undefined, d.entity('user', op.handle).data, {
    removedBefore: d.ctx.removedHandles?.has(op.handle) ?? false,
  });
  return op;
}

export function userRevokeKey(d: Draft, op: OpOf<'user.revoke_key'>): OpOf<'user.revoke_key'> {
  const before = d.entity('user', op.handle).data;
  const already = (before.revoked_keys ?? []).find((r) => r.key === op.key);
  if (already !== undefined) return { ...op, revoked: already.revoked };
  if (!(before.keys ?? []).includes(op.key)) {
    throw violation('missing_ref', m.userLacksKey(op.handle), { ids: [op.handle] });
  }
  const revoked = op.revoked ?? d.ctx.now;
  d.putEntity('user', op.handle, {
    ...before,
    keys: (before.keys ?? []).filter((k) => k !== op.key),
    revoked_keys: [...(before.revoked_keys ?? []), { key: op.key, revoked }],
  });
  const after = d.entity('user', op.handle).data;
  checkUserChange(d.snapshot, d.ctx.actor, op.handle, before, after);
  return { ...op, revoked };
}

export function userRm(d: Draft, op: OpOf<'user.rm'>): OpOf<'user.rm'> {
  const before = d.entity('user', op.handle).data;
  if (d.config.admins.includes(op.handle)) {
    throw violation('admin', m.adminCannotBeRemoved(op.handle), {
      ids: [op.handle],
      hint: m.adminCannotBeRemovedHint,
    });
  }
  d.removeEntity('user', op.handle);
  checkUserChange(d.snapshot, d.ctx.actor, op.handle, before, undefined);
  return op;
}

// --- entity.edit ---------------------------------------------------------------------------

/** Felder, in denen ein neu gesetzter Wert einen User bezeichnet; der `operator` prüft `policy.ts`. */
const USER_REF_FIELDS: Record<NamedKind, readonly string[]> = {
  project: ['lead'],
  user: [],
  sprint: [],
  repo: [],
};

export function entityEdit(d: Draft, op: OpOf<'entity.edit'>): OpOf<'entity.edit'> {
  const { kind, key } = op;
  const current = d.entity(kind, key);
  const before = current.data as Record<string, unknown>;
  const next: Record<string, unknown> = { ...before };
  const label = `${kind} ${key}`;

  for (const [field, change] of Object.entries(op.set ?? {})) {
    const value = Object.hasOwn(before, field) ? before[field] : null;
    if (!settle(label, field, value, change)) continue;
    if (change.to === null) delete next[field];
    else next[field] = change.to;
  }
  for (const field of USER_REF_FIELDS[kind]) {
    const handle = next[field];
    if (typeof handle === 'string' && handle !== before[field]) requireUser(d, handle);
  }

  let body: string | undefined;
  if (op.body !== undefined && current.body !== canonicalBody(op.body.to)) {
    if (bodyHash(current.body) !== op.body.from_hash) {
      throw violation('precondition', m.bodyChanged(label), { ids: [key] });
    }
    body = op.body.to;
  }

  // Das Schema prüft das Ergebnis; die Art ist nur für den Typ des Aufrufs festgelegt.
  d.putEntity(kind as 'project', key, next as Project, body);

  if (kind === 'repo' && next.url !== before.url) {
    const canonical = canonicalOf(next.url as string);
    for (const [name, repo] of d.snapshot.repos) {
      if (name !== key && canonical !== undefined && canonicalOf(repo.data.url) === canonical) {
        throw violation('exists', m.urlAlreadyRegistered(name), {
          ids: [name],
        });
      }
    }
  }
  if (kind === 'user' && (body !== undefined || !sameValue(before, next))) {
    checkUserChange(d.snapshot, d.ctx.actor, key, before as User, next as User);
  }
  return op;
}
