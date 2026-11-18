/**
 * Verletzungen und Invarianten beim Anwenden einer Operation (backe.md §2.16.4): jede Ablehnung
 * trägt einen maschinenlesbaren Grund, und ein Issue darf nur gültige Referenzen, Kanten und
 * Properties neu einführen. Was schon vorher schief war, blockiert nicht.
 */
import { BackeError, type ErrorCode } from '../core/errors.ts';
import { parseRepoRef } from '../core/names.ts';
import type { Issue, PropValue } from '../core/schemas.ts';
import type { Draft } from './draft.ts';
import { findPath } from './graph.ts';
import { checkProps } from './props.ts';

export type Violation =
  | 'precondition'
  | 'exists'
  | 'id_collision'
  | 'open_children'
  | 'has_children'
  | 'references'
  | 'has_subprojects'
  | 'admin'
  | 'occupied'
  | 'not_claimable'
  | 'missing_ref'
  | 'cycle'
  | 'policy'
  | 'prop'
  | 'schema'
  | 'transition'
  | 'too_large';

const CONFLICTS: ReadonlySet<Violation> = new Set<Violation>([
  'precondition',
  'exists',
  'id_collision',
  'open_children',
  'has_children',
  'references',
  'has_subprojects',
  'admin',
  'occupied',
  'not_claimable',
]);

function codeOf(reason: Violation): ErrorCode {
  if (CONFLICTS.has(reason)) return 'conflict';
  return reason === 'missing_ref' ? 'not_found' : 'validation';
}

/** Fehler mit Grund in `details.reason`; der Exit-Code folgt aus dem Grund. */
export function violation(
  reason: Violation,
  message: string,
  extra: { ids?: string[]; hint?: string } = {},
): BackeError {
  const details = extra.ids === undefined ? { reason } : { reason, ids: extra.ids };
  return new BackeError(codeOf(reason), message, {
    details,
    ...(extra.hint === undefined ? {} : { hint: extra.hint }),
  });
}

/**
 * Strukturgleichheit für Frontmatter-Werte, iterativ; Key-Reihenfolge spielt keine Rolle, ein Key
 * mit `undefined` gilt als nicht vorhanden.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  const stack: [unknown, unknown][] = [[a, b]];
  for (let pair = stack.pop(); pair !== undefined; pair = stack.pop()) {
    const [x, y] = pair;
    if (x === y) continue;
    if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return false;
    if (Array.isArray(x) !== Array.isArray(y)) return false;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) return false;
      x.forEach((item, i) => {
        stack.push([item, y[i]]);
      });
      continue;
    }
    const xs = x as Record<string, unknown>;
    const ys = y as Record<string, unknown>;
    const keys = new Set([...Object.keys(xs), ...Object.keys(ys)]);
    for (const k of keys) stack.push([xs[k], ys[k]]);
  }
  return true;
}

/** Einträge von `after`, die `before` nicht hat. */
function added(
  before: readonly string[] | undefined,
  after: readonly string[] | undefined,
): string[] {
  const old = new Set(before ?? []);
  return (after ?? []).filter((x) => !old.has(x));
}

const EDGE_FIELDS = ['parent', 'depends_on', 'blocked_by'] as const;

function edgeTargets(issue: Issue | undefined, field: (typeof EDGE_FIELDS)[number]): string[] {
  if (issue === undefined) return [];
  if (field === 'parent') return issue.parent === undefined ? [] : [issue.parent];
  return issue[field] ?? [];
}

/** Referenzen, die `after` neu einführt und die im Draft fehlen, als `[Bezeichnung, Schlüssel]`. */
function missingRefs(d: Draft, before: Issue | undefined, after: Issue): [string, string][] {
  const missing: [string, string][] = [];
  for (const field of EDGE_FIELDS) {
    for (const id of added(edgeTargets(before, field), edgeTargets(after, field))) {
      if (d.findIssue(id) === undefined) missing.push(['Issue', id]);
    }
  }
  for (const p of added(before?.projects, after.projects)) {
    if (d.findEntity('project', p) === undefined) missing.push(['Projekt', p]);
  }
  for (const sl of added(before?.sprints, after.sprints)) {
    if (d.findEntity('sprint', sl) === undefined) missing.push(['Sprint', sl]);
  }
  for (const entry of added(before?.repos, after.repos)) {
    const { name } = parseRepoRef(entry);
    if (d.findEntity('repo', name) === undefined) missing.push(['Repo', name]);
  }
  const assignee = added(
    before?.assignee === undefined ? [] : [before.assignee],
    after.assignee === undefined ? [] : [after.assignee],
  );
  for (const handle of assignee) {
    if (d.findEntity('user', handle) === undefined) missing.push(['User', handle]);
  }
  return missing;
}

/** Property-Keys, deren Wert sich ändert; entfernte Keys als `null`. */
function touchedProps(before: Issue | undefined, after: Issue): Record<string, PropValue | null> {
  const old = before?.props ?? {};
  const now = after.props ?? {};
  const touched: Record<string, PropValue | null> = {};
  for (const key of new Set([...Object.keys(old), ...Object.keys(now)])) {
    const value = Object.hasOwn(now, key) ? (now[key] as PropValue) : null;
    const previous = Object.hasOwn(old, key) ? (old[key] as PropValue) : null;
    if (!sameValue(previous, value)) touched[key] = value;
  }
  return touched;
}

/**
 * Prüft, was `after` gegenüber `before` neu einführt (backe.md §2.16.4): Referenzen müssen
 * existieren, neue Kanten dürfen keinen Zyklus schließen, je Repo-Name höchstens ein Eintrag in
 * `repos`, berührte Properties passen zu ihrer Deklaration (backe.md §2.24). Der Draft enthält
 * `after` bereits, damit die Pfadsuche den neuen Stand sieht.
 */
export function checkIssueInvariants(d: Draft, before: Issue | undefined, after: Issue): void {
  const missing = missingRefs(d, before, after);
  if (missing.length > 0) {
    const list = missing.map(([label, key]) => `${label} ${key}`).join(', ');
    throw violation('missing_ref', `${after.id}: Referenz auf Nichtexistierendes: ${list}`, {
      ids: missing.map(([, key]) => key),
    });
  }

  // Eine neue Kante id -> t schließt einen Zyklus, wenn t schon zu id zurückführt. Ein alter
  // Zyklus, an dem keine neue Kante beteiligt ist, blockiert nicht.
  for (const field of EDGE_FIELDS) {
    for (const target of added(edgeTargets(before, field), edgeTargets(after, field))) {
      const back = findPath(d.snapshot, field, target, after.id);
      if (back === undefined) continue;
      const cycle = [after.id, ...back];
      throw violation('cycle', `Zyklus in ${field}: ${cycle.join(' -> ')}`, { ids: cycle });
    }
  }

  const names = (after.repos ?? []).map((entry) => parseRepoRef(entry).name);
  for (const entry of added(before?.repos, after.repos)) {
    const { name } = parseRepoRef(entry);
    if (names.filter((n) => n === name).length > 1) {
      throw violation('schema', `${after.id}: Repo "${name}" steht mehrfach in repos`, {
        hint: 'Je Repo ist nur ein Eintrag erlaubt ("name" oder "name@ref").',
      });
    }
  }

  checkProps(d.snapshot.config, touchedProps(before, after));
}
