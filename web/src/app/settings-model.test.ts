import { testIssue, tid } from '../test/state.ts';
import { repoReferences } from './settings-model.ts';

test('repo references match by name with or without ref', () => {
  const issues = [
    testIssue(3, { repos: ['core@main', 'web'] }),
    testIssue(1, { repos: ['web'] }),
    testIssue(2, { repos: ['core'] }),
    testIssue(4, { repos: ['core-tools@main', 'corex'] }),
    testIssue(5),
  ];
  // Nach Rangfolge, nicht nach Eingabe; `core-tools` ist ein anderer Name.
  expect(repoReferences(issues, 'core')).toEqual([tid(2), tid(3)]);
  expect(repoReferences(issues, 'nope')).toEqual([]);
});

test('an unreadable repo entry refers to nothing', () => {
  expect(repoReferences([testIssue(1, { repos: ['Bad Name@x'] })], 'bad')).toEqual([]);
});
