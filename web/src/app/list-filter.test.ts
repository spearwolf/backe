import type { BacklogConfig } from '@backe/core/schemas.ts';
import fc from 'fast-check';
import { m } from '../views/backlog.messages.ts';
import {
  DEFAULT_VIEW,
  EMPTY_FILTER,
  type ListFilter,
  listFilterSearch,
  parseListFilter,
  toSelector,
} from './list-filter.ts';

const config = {
  id_prefix: 'bk',
  props: {
    prio: { type: 'enum', values: ['high', 'medium', 'low'], ordered: true },
    area: { type: 'enum', values: ['ui', 'api'] },
  },
} as unknown as BacklogConfig;
const env = { me: 'spw', config };

// Werte, die beim Lesen nicht an Kommas zerfallen und nicht leer sind.
const token = fc.stringMatching(/^[a-z0-9_./>=<-]{1,8}$/);
const tokens = fc.array(token, { maxLength: 3 });
const arbFilter: fc.Arbitrary<ListFilter> = fc.record({
  states: tokens,
  projects: tokens,
  exact: fc.boolean(),
  sprints: tokens,
  repos: tokens,
  assignee: fc.option(token, { nil: undefined }),
  creator: fc.option(token, { nil: undefined }),
  mode: fc.option(token, { nil: undefined }),
  props: fc.array(fc.stringMatching(/^[a-z]{1,4}=[a-z0-9,]{1,8}$/), { maxLength: 3 }),
  hasProps: tokens,
  text: fc.string({ maxLength: 12 }),
});

/** `fc.record` legt `undefined`-Felder an; die URL-Form kennt sie nicht. */
function compact(f: ListFilter): ListFilter {
  return Object.fromEntries(
    Object.entries(f).filter(([, v]) => v !== undefined),
  ) as unknown as ListFilter;
}

test('empty filter has an empty query', () => {
  expect(listFilterSearch(EMPTY_FILTER)).toBe('');
  expect(parseListFilter('')).toEqual(EMPTY_FILTER);
});

test('query round-trips', () => {
  fc.assert(
    fc.property(arbFilter, (f) => {
      expect(parseListFilter(listFilterSearch(f))).toEqual(compact(f));
    }),
  );
});

test('query uses the flag names of issue list in a fixed order', () => {
  const f: ListFilter = {
    ...EMPTY_FILTER,
    text: 'login',
    states: ['todo'],
    hasProps: ['points'],
    exact: true,
    projects: ['web'],
    mode: 'ready',
  };
  expect(listFilterSearch(f)).toBe(
    '?state=todo&project=web&exact=1&mode=ready&has-prop=points&q=login',
  );
});

test('commas split like the cli, but not inside prop', () => {
  const f = parseListFilter('?state=todo,review&state=done&prop=area%3Dui%2Capi');
  expect(f.states).toEqual(['todo', 'review', 'done']);
  expect(f.props).toEqual(['area=ui,api']);
});

test('selector of the empty filter is issue list --all', () => {
  expect(toSelector(EMPTY_FILTER, DEFAULT_VIEW, env)).toEqual({
    selector: { filter: {}, exact: false, tree: true, sort: 'rank', props: [] },
    errors: [],
  });
});

test('selector carries every filter', () => {
  const f = parseListFilter(
    '?state=todo&project=web&exact=1&sprint=s1&repo=app&assignee=none&creator=me&mode=ready&prop=prio>=medium&has-prop=area&q=%20Login%20',
  );
  const { selector, errors } = toSelector(f, { tree: false, sort: 'created' }, env);
  expect(errors).toEqual([]);
  expect(selector).toEqual({
    states: ['todo'],
    filter: { project: ['web'], sprint: ['s1'], repo: ['app'] },
    exact: true,
    assignee: 'none',
    creator: 'spw',
    mode: 'ready',
    props: [{ key: 'prio', op: 'ge', value: 'medium', raw: 'medium' }],
    hasProps: ['area'],
    text: ' login ',
    tree: false,
    sort: 'created',
  });
});

test('me resolves to the identity', () => {
  const f = { ...EMPTY_FILTER, assignee: 'me' };
  expect(toSelector(f, DEFAULT_VIEW, env).selector.assignee).toBe('spw');
});

test('all with other states is a field error, like the cli', () => {
  const { selector, errors } = toSelector(
    { ...EMPTY_FILTER, states: ['all', 'todo'] },
    DEFAULT_VIEW,
    env,
  );
  expect(errors).toEqual([{ field: 'states', value: 'all', message: m.allStandsAlone }]);
  expect(selector.states).toEqual(['todo']);
});

test('only state splits at commas', () => {
  const f = parseListFilter('?project=a,b&sprint=c,d&repo=e,f&has-prop=g,h');
  expect([f.projects, f.sprints, f.repos, f.hasProps]).toEqual([
    ['a,b'],
    ['c,d'],
    ['e,f'],
    ['g,h'],
  ]);
});

test('the text keeps its spaces, like the cli', () => {
  expect(toSelector({ ...EMPTY_FILTER, text: ' Login ' }, DEFAULT_VIEW, env).selector.text).toBe(
    ' login ',
  );
  expect(
    toSelector({ ...EMPTY_FILTER, text: '' }, DEFAULT_VIEW, env).selector.text,
  ).toBeUndefined();
});

test('an invalid handle is a field error', () => {
  const { selector, errors } = toSelector(
    { ...EMPTY_FILTER, assignee: 'Bad Name', creator: 'x y' },
    DEFAULT_VIEW,
    env,
  );
  expect(errors).toEqual([
    { field: 'assignee', value: 'Bad Name', message: m.invalidHandle('Bad Name') },
    { field: 'creator', value: 'x y', message: m.invalidHandle('x y') },
  ]);
  expect(selector.assignee).toBeUndefined();
  expect(selector.creator).toBeUndefined();
});

test('in-progress normalizes', () => {
  const f = { ...EMPTY_FILTER, states: ['in-progress'] };
  expect(toSelector(f, DEFAULT_VIEW, env).selector.states).toEqual(['in_progress']);
});

test('bad url values become field errors', () => {
  const { selector, errors } = toSelector(
    parseListFilter('?state=bogus&state=todo&prop=prio>>x&mode=fast&assignee=me&sprint=s1'),
    DEFAULT_VIEW,
    { ...env, me: null },
  );
  expect(errors.map((e) => e.field).sort()).toEqual(['assignee', 'mode', 'props', 'states']);
  expect(errors.find((e) => e.field === 'mode')).toEqual({
    field: 'mode',
    value: 'fast',
    message: m.unknownMode('fast'),
  });
  expect(errors.find((e) => e.field === 'assignee')?.message).toBe(m.meNeedsIdentity);
  expect(selector).toMatchObject({ states: ['todo'], filter: { sprint: ['s1'] }, props: [] });
  expect(selector.assignee).toBeUndefined();
  expect(selector.mode).toBeUndefined();
});

test('only invalid states fall back to open', () => {
  const { selector, errors } = toSelector(
    { ...EMPTY_FILTER, states: ['bogus'] },
    DEFAULT_VIEW,
    env,
  );
  expect(selector.states).toBeUndefined();
  expect(errors).toHaveLength(1);
});

test('range on an unordered key is a field error', () => {
  const { selector, errors } = toSelector(
    { ...EMPTY_FILTER, props: ['area>=ui'] },
    DEFAULT_VIEW,
    env,
  );
  expect(errors.map((e) => [e.field, e.value])).toEqual([['props', 'area>=ui']]);
  expect(selector.props).toEqual([]);
});
