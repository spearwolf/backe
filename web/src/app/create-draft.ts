/**
 * Entwurf des Anlegen-Dialogs (ui.md §2.12): rein, ohne Browser-Zugriff. Vorbelegt wird aus dem
 * Filter des Tabs Backlog oder aus einer Board-Bahn (ui.md §2.8); `createArgs` macht daraus genau
 * den Aufruf, den der Dialog zeigt.
 */
import { MAIN_LINE, type State } from '@backe/core/state.ts';
import type { IssueJson, ToolArgs } from '@backe/ui/api.ts';
import type { ListFilter } from './list-filter.ts';

export type CreateDraft = {
  title: string;
  body: string;
  state: State;
  projects: string[];
  sprints: string[];
  repos: string[];
  assignee: string | null;
  parent: string;
  depends_on: string[];
  /** `undefined` heißt »nicht gesetzt«, wie ein leeres Eingabefeld. */
  props: Record<string, unknown>;
};

export const EMPTY_DRAFT: CreateDraft = {
  title: '',
  body: '',
  state: 'backlog',
  projects: [],
  sprints: [],
  repos: [],
  assignee: null,
  parent: '',
  depends_on: [],
  props: {},
};

/** Ein State aus der URL (`in-progress` wie im CLI), aber nur einer der Hauptlinie. */
function mainLineState(raw: string): State | undefined {
  const snake = raw.trim().replaceAll('-', '_');
  return MAIN_LINE.find((s) => s === snake);
}

/**
 * Projekte, Sprints, Repos und Assignee übernimmt der Entwurf aus dem Filter; den State nur, wenn
 * der Filter genau einen der Hauptlinie nennt — mehrere, `all` oder ein Seitenzustand sagen nicht,
 * wo ein neues Issue hingehört. Modus, Creator, Properties und Text belegen nichts vor.
 */
export function draftFromFilter(filter: ListFilter, me: string | null): CreateDraft {
  const [only, ...more] = filter.states;
  const state = only !== undefined && more.length === 0 ? mainLineState(only) : undefined;
  let assignee: string | null = null;
  if (filter.assignee === 'me') assignee = me;
  else if (filter.assignee !== undefined && filter.assignee !== 'none') assignee = filter.assignee;
  return {
    ...EMPTY_DRAFT,
    state: state ?? EMPTY_DRAFT.state,
    projects: [...filter.projects],
    sprints: [...filter.sprints],
    repos: [...filter.repos],
    assignee,
  };
}

/**
 * BK §2.23: Mit Parent stehen dessen `projects`, `sprints` und `repos` im Entwurf, an Stelle der
 * bisherigen — wie `issue create --parent` ohne weitere Flags. Danach darf man sie wieder ändern.
 */
export function withParent(draft: CreateDraft, parent: IssueJson): CreateDraft {
  return {
    ...draft,
    parent: parent.id,
    projects: [...(parent.projects ?? [])],
    sprints: [...(parent.sprints ?? [])],
    repos: [...(parent.repos ?? [])],
  };
}

/**
 * Listen gehen immer mit, auch leer: Sonst setzte der Server Kontext oder Parent ein, und das Issue
 * sähe anders aus als im Dialog. Leere Felder fehlen; ein ungesetztes Property ebenso.
 */
export function createArgs(draft: CreateDraft): ToolArgs['issue_create'] {
  const args: ToolArgs['issue_create'] = {
    title: draft.title.trim(),
    state: draft.state,
    projects: [...draft.projects],
    sprints: [...draft.sprints],
    repos: [...draft.repos],
  };
  if (draft.body.trim() !== '') args.body = draft.body;
  if (draft.assignee !== null) args.assignee = draft.assignee;
  const parent = draft.parent.trim();
  if (parent !== '') args.parent = parent;
  if (draft.depends_on.length > 0) args.depends_on = [...draft.depends_on];
  const props = Object.fromEntries(Object.entries(draft.props).filter(([, v]) => v !== undefined));
  if (Object.keys(props).length > 0) args.props = props;
  return args;
}
