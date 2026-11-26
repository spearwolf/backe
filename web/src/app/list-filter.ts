/**
 * Filter des Tabs Backlog (ui.md §2.7): rein, ohne Browser-Zugriff. Die URL-Form nutzt die
 * Flag-Namen von `issue list`; `toSelector` macht daraus den Selektor von `selectIssues`, mit
 * derselben Prüfung wie das CLI — nur dass ein ungültiger Wert ein Feldfehler wird statt eines
 * Abbruchs, und die übrigen Filter weiter wirken.
 */
import { BackeError } from '@backe/core/errors.ts';
import { isHandle } from '@backe/core/names.ts';
import type { BacklogConfig } from '@backe/core/schemas.ts';
import { normalizeStateInput, type State } from '@backe/core/state.ts';
import type { IssueSelector } from '@backe/ops/issue-query.ts';
import { checkPropFilter, type PropFilter, parsePropFilter } from '@backe/ops/props.ts';
import { m } from '../views/backlog.messages.ts';

export type ListMode = 'ready' | 'blocked' | 'unblockable';
export const LIST_MODES: readonly ListMode[] = ['ready', 'blocked', 'unblockable'];

export type ListFilter = {
  /** Leer = offen (Default von `issue list`); `['all']` = alle. */
  states: readonly string[];
  projects: readonly string[];
  exact: boolean;
  sprints: readonly string[];
  repos: readonly string[];
  /** Handle, `me` oder `none`. */
  assignee?: string;
  creator?: string;
  /** Roh aus der URL; `toSelector` prüft. */
  mode?: string;
  /** Ausdrücke wie `--prop`. */
  props: readonly string[];
  hasProps: readonly string[];
  text: string;
};

export type ListView = { tree: boolean; sort: 'rank' | 'created' };

export const EMPTY_FILTER: ListFilter = {
  states: [],
  projects: [],
  exact: false,
  sprints: [],
  repos: [],
  props: [],
  hasProps: [],
  text: '',
};

export const DEFAULT_VIEW: ListView = { tree: true, sort: 'rank' };

type ListKey = 'states' | 'projects' | 'sprints' | 'repos' | 'props' | 'hasProps';

/** URL-Parameter in Schreibreihenfolge; `split` teilt zusätzlich an Kommas wie `--state` im CLI. */
const LISTS: readonly { key: ListKey; param: string; split: boolean }[] = [
  { key: 'states', param: 'state', split: true },
  { key: 'projects', param: 'project', split: false },
  { key: 'sprints', param: 'sprint', split: false },
  { key: 'repos', param: 'repo', split: false },
  { key: 'props', param: 'prop', split: false },
  { key: 'hasProps', param: 'has-prop', split: false },
];

function listOf(params: URLSearchParams, param: string, split: boolean): string[] {
  const raw = params.getAll(param);
  const parts = split ? raw.flatMap((v) => v.split(',')) : raw;
  return parts.map((v) => v.trim()).filter((v) => v !== '');
}

function single(params: URLSearchParams, param: string): string | undefined {
  const v = params.get(param)?.trim();
  return v === undefined || v === '' ? undefined : v;
}

export function parseListFilter(search: string): ListFilter {
  const params = new URLSearchParams(search);
  const f: ListFilter = { ...EMPTY_FILTER };
  for (const { key, param, split } of LISTS) f[key] = listOf(params, param, split);
  f.exact = params.get('exact') === '1';
  const assignee = single(params, 'assignee');
  const creator = single(params, 'creator');
  const mode = single(params, 'mode');
  if (assignee !== undefined) f.assignee = assignee;
  if (creator !== undefined) f.creator = creator;
  if (mode !== undefined) f.mode = mode;
  f.text = params.get('q') ?? '';
  return f;
}

/** `''` für den leeren Filter, sonst `?…` in fester Reihenfolge. */
export function listFilterSearch(f: ListFilter): string {
  const params = new URLSearchParams();
  const add = (param: string, values: readonly string[]) => {
    for (const v of values) params.append(param, v);
  };
  add('state', f.states);
  add('project', f.projects);
  if (f.exact) params.append('exact', '1');
  add('sprint', f.sprints);
  add('repo', f.repos);
  if (f.assignee !== undefined) params.append('assignee', f.assignee);
  if (f.creator !== undefined) params.append('creator', f.creator);
  if (f.mode !== undefined) params.append('mode', f.mode);
  add('prop', f.props);
  add('has-prop', f.hasProps);
  if (f.text !== '') params.append('q', f.text);
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

export type FilterError = { field: keyof ListFilter; value: string; message: string };

export function toSelector(
  f: ListFilter,
  view: ListView,
  env: { me: string | null; config: BacklogConfig },
): { selector: IssueSelector; errors: FilterError[] } {
  const errors: FilterError[] = [];
  const fail = (field: keyof ListFilter, value: string, message: string): undefined => {
    errors.push({ field, value, message });
    return undefined;
  };
  const attempt = <T>(field: keyof ListFilter, value: string, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (err) {
      if (!(err instanceof BackeError)) throw err;
      return fail(field, value, err.message);
    }
  };
  // Wie `resolveHandle` im CLI; `none` gibt es nur beim Assignee.
  const handle = (field: 'assignee' | 'creator', value: string | undefined) => {
    if (value === undefined || (field === 'assignee' && value === 'none')) return value;
    if (value === 'me') return env.me ?? fail(field, value, m.meNeedsIdentity);
    return isHandle(value) ? value : fail(field, value, m.invalidHandle(value));
  };

  const sel: IssueSelector = { filter: {}, exact: f.exact, tree: view.tree, sort: view.sort };

  if (f.states.includes('all') && f.states.length > 1) fail('states', 'all', m.allStandsAlone);
  if (f.states.length === 1 && f.states[0] === 'all') sel.states = 'all';
  else {
    const states = f.states
      .filter((v) => v !== 'all')
      .flatMap((v) => attempt('states', v, () => normalizeStateInput(v)) ?? []);
    if (states.length > 0) sel.states = states as State[];
  }
  if (f.projects.length > 0) sel.filter.project = [...f.projects];
  if (f.sprints.length > 0) sel.filter.sprint = [...f.sprints];
  if (f.repos.length > 0) sel.filter.repo = [...f.repos];

  const assignee = handle('assignee', f.assignee);
  if (assignee !== undefined) sel.assignee = assignee;
  const creator = handle('creator', f.creator);
  if (creator !== undefined) sel.creator = creator;

  if (f.mode !== undefined) {
    const mode = f.mode;
    if ((LIST_MODES as readonly string[]).includes(mode)) sel.mode = mode as ListMode;
    else fail('mode', mode, m.unknownMode(mode));
  }

  sel.props = f.props.flatMap((expr): PropFilter[] => {
    const parsed = attempt('props', expr, () => {
      const p = parsePropFilter(expr);
      checkPropFilter(p, env.config);
      return p;
    });
    return parsed === undefined ? [] : [parsed];
  });
  if (f.hasProps.length > 0) sel.hasProps = [...f.hasProps];

  // Ungetrimmt wie `-q` im CLI.
  if (f.text !== '') sel.text = f.text.toLowerCase();
  return { selector: sel, errors };
}
