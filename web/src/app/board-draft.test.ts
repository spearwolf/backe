import { draftForCell } from './board-draft.ts';
import { NO_LANE } from './board-model.ts';

test('a sprint cell drafts state and sprint', () => {
  const d = draftForCell('sprint', 's1', 'todo', 'T');
  expect(d).toMatchObject({ title: 'T', state: 'todo', sprints: ['s1'], projects: [], repos: [] });
});

test('the no-lane and group none draft no membership', () => {
  for (const [group, lane] of [
    ['sprint', NO_LANE],
    ['project', NO_LANE],
    ['repo', NO_LANE],
    ['none', NO_LANE],
    ['none', 'x'],
  ] as const) {
    const d = draftForCell(group, lane, 'review');
    expect(d).toMatchObject({ state: 'review', sprints: [], projects: [], repos: [] });
  }
});

test('repo and project lanes draft their membership', () => {
  expect(draftForCell('repo', 'api', 'todo')).toMatchObject({ repos: ['api'], sprints: [] });
  expect(draftForCell('project', 'p', 'done')).toMatchObject({ projects: ['p'], repos: [] });
});
