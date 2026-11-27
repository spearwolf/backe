/**
 * Entwurf für »Schnell anlegen« in einer Zelle des Boards (ui.md §2.8, §2.12): rein, ohne
 * Browser-Zugriff. Die Spalte ist der State, die Bahn die Mitgliedschaft.
 */
import type { State } from '@backe/core/state.ts';
import { type BoardGroup, NO_LANE } from './board-model.ts';
import { type CreateDraft, EMPTY_DRAFT } from './create-draft.ts';

/**
 * State = Spalte, Mitgliedschaft = Bahn. »ohne …« (`NO_LANE`) und die Gruppierung `none` haben
 * keine Bahn und damit auch keine Mitgliedschaft. Die Listen gehen immer ausdrücklich mit
 * (`createArgs`), auch leer — sonst setzte der Server einen Kontext ein.
 */
export function draftForCell(
  group: BoardGroup,
  lane: string,
  column: State,
  title = '',
): CreateDraft {
  const member = group !== 'none' && lane !== NO_LANE ? [lane] : [];
  return {
    ...EMPTY_DRAFT,
    title,
    state: column,
    projects: group === 'project' ? member : [],
    sprints: group === 'sprint' ? member : [],
    repos: group === 'repo' ? member : [],
  };
}
