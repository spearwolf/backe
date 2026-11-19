/**
 * Lese-Grundlagen der Services: Snapshot öffnen, Referenzen und Handles auflösen, States und
 * Kontextfilter normalisieren (backe.md §2.2, §2.19).
 */
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import { resolveShortId } from '../core/ids.ts';
import { isHandle } from '../core/names.ts';
import { normalizeStateInput, type State } from '../core/state.ts';
import { type BacklogSnapshot, loadSnapshot } from '../store/snapshot.ts';

/** Arbeitskopie des Kontexts; ohne eine `not_found` mit Clone-/Add-Hinweis. */
export function requireRoot(ctx: ResolvedContext): string {
  const root = ctx.backlog.root;
  const name = ctx.backlog.value;
  if (root === undefined) {
    const remote = ctx.userConfig.backlogs?.[name]?.remote;
    throw new BackeError('not_found', `Keine Arbeitskopie von »${name}« vorhanden`, {
      hint:
        remote === undefined ? `backe backlog add ${name} <pfad>` : `backe backlog clone ${remote}`,
    });
  }
  return root;
}

/** Lädt den Snapshot der Arbeitskopie des Kontexts (siehe `requireRoot`). */
export async function openSnapshot(
  ctx: ResolvedContext,
): Promise<{ root: string; snapshot: BacklogSnapshot }> {
  const root = requireRoot(ctx);
  return { root, snapshot: await loadSnapshot(root) };
}

/**
 * Löst eine ID oder Kurzform gegen die geladenen Issues und die Keys kaputter Issue-Dateien auf.
 * Trifft die Eingabe ein kaputtes Issue, ist das ein `validation`-Fehler mit Pfad und Grund
 * statt eines irreführenden »nicht gefunden«.
 */
export function resolveIssueRef(s: BacklogSnapshot, input: string): string {
  const broken = new Map<string, { path: string; message: string }>();
  for (const p of s.problems) {
    if (p.kind === 'issue' && p.key !== undefined) broken.set(p.key, p);
  }
  const id = resolveShortId(input, [...s.issues.keys(), ...broken.keys()]);
  const problem = broken.get(id);
  if (problem !== undefined) {
    throw new BackeError('validation', `${problem.path}: ${problem.message}`);
  }
  return id;
}

/** `me` ist die Identität des Kontexts, sonst muss die Eingabe ein gültiger Handle sein. */
export function resolveHandle(ctx: ResolvedContext, input: string): string {
  if (input === 'me') {
    const me = ctx.user.value;
    if (me === undefined) {
      throw new BackeError('usage', '»me« braucht eine Identität', {
        hint: 'mit --as <handle> angeben oder eine Identität setzen',
      });
    }
    return me;
  }
  if (!isHandle(input)) {
    throw new BackeError('validation', `Ungültiger Handle: »${input}«`);
  }
  return input;
}

/** Komma-getrennte States (auch `in-progress`) oder `all` allein. */
export function normalizeStates(input: readonly string[]): State[] | 'all' {
  const parts = input
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v !== '');
  if (parts.length === 0) throw new BackeError('validation', 'Kein State angegeben');
  if (parts.includes('all')) {
    if (parts.length > 1) {
      throw new BackeError('validation', '»all« steht allein');
    }
    return 'all';
  }
  return parts.map((p) => normalizeStateInput(p));
}

export type FilterSource = 'context' | 'flag';
type FilterValues = { project?: string[]; sprint?: string[]; repo?: string[] };

const FILTER_KEYS = ['project', 'sprint', 'repo'] as const;

/**
 * Filter einer Liste: explizit gesetzte Werte ersetzen den Kontextwert, `all` verwirft die Werte
 * aus dem Kontext (nicht die per Flag gesetzten). `header` nennt `backlog` und jeden Wert, der
 * aus dem Kontext stammt, damit die Ausgabe zeigt, was ungefragt mitgefiltert wurde.
 */
export function effectiveFilter(
  ctx: ResolvedContext,
  explicit: FilterValues,
  all: boolean,
): FilterValues & { header: Record<string, string> } {
  const out: FilterValues = {};
  const fromContext: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const given = explicit[key];
    if (given !== undefined) {
      out[key] = given;
      continue;
    }
    const { value, source } = ctx[key];
    if (typeof value !== 'string') continue;
    const kind: FilterSource = source.kind === 'flag' ? 'flag' : 'context';
    if (kind === 'context') {
      if (all) continue;
      fromContext[key] = value;
    }
    out[key] = [value];
  }
  const header =
    Object.keys(fromContext).length === 0 ? {} : { backlog: ctx.backlog.value, ...fromContext };
  return { ...out, header };
}
