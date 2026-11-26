import { testIssue } from '../test/state.ts';
import { createArgs, draftFromFilter, EMPTY_DRAFT, withParent } from './create-draft.ts';
import { EMPTY_FILTER, type ListFilter } from './list-filter.ts';

const filter = (over: Partial<ListFilter>): ListFilter => ({ ...EMPTY_FILTER, ...over });

test('draft from filter', () => {
  const draft = draftFromFilter(
    filter({
      projects: ['web'],
      sprints: ['s1'],
      repos: ['api'],
      assignee: 'me',
      states: ['todo'],
      creator: 'anna',
      mode: 'ready',
      props: ['prio>=high'],
      text: 'login',
    }),
    'spw',
  );
  expect(draft).toEqual({
    ...EMPTY_DRAFT,
    state: 'todo',
    projects: ['web'],
    sprints: ['s1'],
    repos: ['api'],
    assignee: 'spw',
  });
  expect(draftFromFilter(filter({ assignee: 'anna' }), 'spw').assignee).toBe('anna');
  expect(draftFromFilter(filter({ assignee: 'none' }), 'spw').assignee).toBeNull();
  expect(draftFromFilter(filter({ assignee: 'me' }), null).assignee).toBeNull();
  expect(draftFromFilter(filter({}), 'spw')).toEqual(EMPTY_DRAFT);
  // Die URL-Form erlaubt Bindestriche wie `--state in-progress` im CLI.
  expect(draftFromFilter(filter({ states: ['in-progress'] }), null).state).toBe('in_progress');
});

test('several states fall back to backlog', () => {
  expect(EMPTY_DRAFT.state).toBe('backlog');
  for (const states of [['todo', 'review'], ['all'], ['blocked'], ['cancelled'], ['nope']]) {
    expect(draftFromFilter(filter({ states }), 'spw').state).toBe('backlog');
  }
});

test('a parent prefills projects, sprints and repos', () => {
  const parent = testIssue(7, { projects: ['api'], sprints: ['s2'], repos: ['core@main'] });
  const draft = withParent(
    { ...EMPTY_DRAFT, title: 'Kind', projects: ['web'], sprints: ['s1'], assignee: 'spw' },
    parent,
  );
  expect(draft).toEqual({
    ...EMPTY_DRAFT,
    title: 'Kind',
    assignee: 'spw',
    parent: parent.id,
    projects: ['api'],
    sprints: ['s2'],
    repos: ['core@main'],
  });
  // Ein Parent ohne Listen leert sie: Die Datei sagt dann dasselbe wie beim CLI (BK §2.23).
  expect(withParent({ ...EMPTY_DRAFT, projects: ['web'] }, testIssue(8))).toMatchObject({
    projects: [],
    sprints: [],
    repos: [],
  });
});

test('create args send lists always and skip empty fields', () => {
  expect(createArgs({ ...EMPTY_DRAFT, title: '  Neu  ', body: '  \n', parent: ' ' })).toEqual({
    title: 'Neu',
    state: 'backlog',
    projects: [],
    sprints: [],
    repos: [],
  });
  expect(
    createArgs({
      title: 'Voll',
      body: 'Text\n',
      state: 'todo',
      projects: ['web'],
      sprints: ['s1'],
      repos: ['api'],
      assignee: 'anna',
      parent: ' bk-t0001 ',
      depends_on: ['bk-t0002'],
      props: { prio: 'high', size: undefined, flag: false },
    }),
  ).toEqual({
    title: 'Voll',
    body: 'Text\n',
    state: 'todo',
    projects: ['web'],
    sprints: ['s1'],
    repos: ['api'],
    assignee: 'anna',
    parent: 'bk-t0001',
    depends_on: ['bk-t0002'],
    props: { prio: 'high', flag: false },
  });
  expect(createArgs({ ...EMPTY_DRAFT, title: 'x', props: { a: undefined } })).not.toHaveProperty(
    'props',
  );
});
