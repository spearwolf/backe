import { BackeError } from '@backe/core/errors.ts';
import { Store } from '../../../data/store.ts';
import { testIssue, testState, tid } from '../../../test/state.ts';
import { overlayOf } from './state-write.ts';

const thrown = vi.hoisted(() => ({ error: undefined as unknown }));
vi.mock('../../../app/optimistic.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../app/optimistic.ts')>();
  return {
    ...actual,
    stateOverlay: (...args: Parameters<typeof actual.stateOverlay>) => {
      if (thrown.error !== undefined) throw thrown.error;
      return actual.stateOverlay(...args);
    },
  };
});

afterEach(() => {
  thrown.error = undefined;
});

function store() {
  const s = new Store();
  s.load(testState([testIssue(1)]));
  return s;
}

const move = { to: 'in_progress', tool: 'issue_move', needsBlockedBy: false } as const;

test('overlayOf previews the transition', () => {
  expect(overlayOf(store(), tid(1), move)?.get(tid(1))?.state).toBe('in_progress');
});

test('a refused calculation drops only the preview', () => {
  thrown.error = new BackeError('usage', 'nicht erlaubt');
  expect(overlayOf(store(), tid(1), move)).toBeUndefined();
});

test('any other throw is a client bug and propagates', () => {
  thrown.error = new TypeError('kaputt');
  expect(() => overlayOf(store(), tid(1), move)).toThrow(TypeError);
});
