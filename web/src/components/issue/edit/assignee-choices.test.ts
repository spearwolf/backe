import { setLocale } from '@backe/i18n/locale.ts';
import { assigneeChoices, NO_ASSIGNEE } from './inputs.tsx';

afterEach(() => setLocale('de'));

test('assignee labels follow the locale, the values stay raw', () => {
  expect(assigneeChoices(null, 'spw', ['ada', 'spw'])).toEqual([
    { value: NO_ASSIGNEE, label: 'niemand' },
    { value: 'spw', label: 'ich (spw)' },
    { value: 'ada', label: 'ada' },
  ]);
  setLocale('en');
  expect(assigneeChoices(null, 'spw', ['ada']).map((c) => c.label)).toEqual([
    'nobody',
    'me (spw)',
    'ada',
  ]);
});

test('an unknown handle stays a choice', () => {
  expect(assigneeChoices('gone', null, ['ada']).map((c) => c.value)).toEqual([
    NO_ASSIGNEE,
    'ada',
    'gone',
  ]);
});
