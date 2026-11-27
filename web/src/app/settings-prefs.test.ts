import { isSettingsSection, SETTINGS_SECTIONS } from './settings-model.ts';
import { readFolded, writeFolded } from './settings-prefs.ts';

afterEach(() => localStorage.clear());

test('the sections come in the order of the sketch', () => {
  expect(SETTINGS_SECTIONS).toEqual([
    'repositories',
    'projects',
    'sprints',
    'users',
    'backlog',
    'interface',
  ]);
  expect(isSettingsSection('projects')).toBe(true);
  expect(isSettingsSection('toString')).toBe(false);
  expect(isSettingsSection('')).toBe(false);
});

test('folded sections survive and tolerate garbage', () => {
  expect(readFolded('acme')).toEqual({});

  localStorage.setItem('backe-ui:acme:settings', '{broken');
  expect(readFolded('acme')).toEqual({});
  localStorage.setItem('backe-ui:acme:settings', JSON.stringify(['projects']));
  expect(readFolded('acme')).toEqual({});

  // Je Feld: Was taugt, bleibt; fremde Abschnitte und Nicht-Booleans fallen weg.
  localStorage.setItem(
    'backe-ui:acme:settings',
    JSON.stringify({ folded: { projects: true, sprints: 'yes', nope: true, users: false } }),
  );
  expect(readFolded('acme')).toEqual({ projects: true, users: false });
  localStorage.setItem('backe-ui:acme:settings', JSON.stringify({ folded: 3 }));
  expect(readFolded('acme')).toEqual({});

  writeFolded('acme', { backlog: true });
  expect(readFolded('acme')).toEqual({ backlog: true });
  expect(readFolded('other')).toEqual({});
});
