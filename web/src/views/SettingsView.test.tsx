import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { m as app } from '../app/app.messages.ts';
import { SETTINGS_SECTIONS } from '../app/settings-model.ts';
import { readFolded, writeFolded } from '../app/settings-prefs.ts';
import { call, region, registerSettingsHarness, scrolled, view } from '../test/settings-view.tsx';
import { m } from './settings.messages.ts';

registerSettingsHarness();

const titles = () => [
  m.sectionRepositories,
  m.sectionProjects,
  m.sectionSprints,
  m.sectionUsers,
  m.sectionBacklog,
  m.sectionInterface,
];

const toggle = (title: string) => within(region(title)).getByRole('button', { name: title });
const nav = () => screen.getByRole('navigation', { name: m.sectionsNav });

test('all sections show with a navigation', () => {
  view();
  expect(screen.getByRole('heading', { level: 1, name: app.settings })).toBeTruthy();
  expect(screen.getAllByRole('region').map((r) => r.getAttribute('id'))).toEqual(
    SETTINGS_SECTIONS.map((s) => `settings-${s}`),
  );
  for (const title of titles()) {
    expect(region(title)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeTruthy();
    // Default offen.
    expect(toggle(title).getAttribute('aria-expanded')).toBe('true');
  }
  const links = within(nav()).getAllByRole('link');
  expect(links.map((l) => l.textContent)).toEqual(titles());
  expect(links.map((l) => l.getAttribute('href'))).toEqual(
    SETTINGS_SECTIONS.map((s) => `/b/acme/settings/${s}`),
  );
  // Ohne Abschnitt in der Route ist keiner gewählt, und nichts scrollt.
  expect(links.filter((l) => l.hasAttribute('aria-current'))).toEqual([]);
  expect(scrolled).not.toHaveBeenCalled();
});

test('a section route unfolds, scrolls and focuses it', async () => {
  const user = userEvent.setup();
  writeFolded('acme', { projects: true });
  const { go } = view({ section: 'projects' });

  expect(toggle(m.sectionProjects).getAttribute('aria-expanded')).toBe('true');
  expect(readFolded('acme').projects).toBe(false);
  expect(scrolled).toHaveBeenCalledTimes(1);
  expect(scrolled.mock.contexts[0]).toBe(region(m.sectionProjects));
  expect(scrolled).toHaveBeenCalledWith({ block: 'start' });
  expect(document.activeElement).toBe(toggle(m.sectionProjects));
  const current = within(nav()).getByRole('link', { name: m.sectionProjects });
  expect(current.getAttribute('aria-current')).toBe('location');

  // Ein Render ohne Routenwechsel scrollt nicht und lässt den Fokus, wo er ist.
  await user.click(toggle(m.sectionSprints));
  expect(document.activeElement).toBe(toggle(m.sectionSprints));
  expect(scrolled).toHaveBeenCalledTimes(1);

  // Der Link der Navigation wechselt die Route.
  await user.click(within(nav()).getByRole('link', { name: m.sectionSprints }));
  expect(window.location.pathname).toBe('/b/acme/settings/sprints');
  expect(toggle(m.sectionSprints).getAttribute('aria-expanded')).toBe('true');
  expect(scrolled).toHaveBeenCalledTimes(2);
  expect(scrolled.mock.contexts[1]).toBe(region(m.sectionSprints));
  expect(document.activeElement).toBe(toggle(m.sectionSprints));

  go('users');
  expect(document.activeElement).toBe(toggle(m.sectionUsers));
  expect(scrolled).toHaveBeenCalledTimes(3);
});

test('the link of the current section shows it again', async () => {
  const user = userEvent.setup();
  view({ section: 'projects' });
  expect(scrolled).toHaveBeenCalledTimes(1);
  // Weggescrollt und eingeklappt; der Fokus steht woanders.
  await user.click(toggle(m.sectionProjects));
  await user.click(toggle(m.sectionBacklog));
  const length = window.history.length;

  await user.click(within(nav()).getByRole('link', { name: m.sectionProjects }));
  expect(window.location.pathname).toBe('/b/acme/settings/projects');
  expect(window.history.length).toBe(length);
  expect(scrolled).toHaveBeenCalledTimes(2);
  expect(scrolled.mock.contexts[1]).toBe(region(m.sectionProjects));
  expect(toggle(m.sectionProjects).getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(toggle(m.sectionProjects));
});

test('folding is remembered per backlog', async () => {
  const user = userEvent.setup();
  const first = view();
  expect(screen.getByRole('group', { name: app.theme })).toBeTruthy();
  await user.click(toggle(m.sectionInterface));
  expect(toggle(m.sectionInterface).getAttribute('aria-expanded')).toBe('false');
  // Eingeklappt steht nur der Kopf da.
  expect(screen.queryByRole('group', { name: app.theme })).toBeNull();
  expect(readFolded('acme')).toEqual({ interface: true });
  first.unmount();

  const again = view();
  expect(toggle(m.sectionInterface).getAttribute('aria-expanded')).toBe('false');
  await user.click(toggle(m.sectionInterface));
  expect(screen.getByRole('group', { name: app.theme })).toBeTruthy();
  expect(readFolded('acme')).toEqual({ interface: false });
  await user.click(toggle(m.sectionInterface));
  again.unmount();

  view({ backlog: 'other' });
  expect(toggle(m.sectionInterface).getAttribute('aria-expanded')).toBe('true');
});

test('an unknown section shows a notice', () => {
  const { go } = view({ section: 'nope' });
  expect(screen.getByText(m.unknownSection('nope'))).toBeTruthy();
  expect(screen.getAllByRole('region')).toHaveLength(6);
  expect(scrolled).not.toHaveBeenCalled();
  expect(within(nav()).queryAllByRole('link', { current: 'location' })).toEqual([]);

  go('backlog');
  expect(screen.queryByText(m.unknownSection('nope'))).toBeNull();
  expect(document.activeElement).toBe(toggle(m.sectionBacklog));
});

test('the view mounts after a section route without stealing focus twice', () => {
  // Ein zweites Mounten an derselben Route (Sprachwechsel in `App`) zeigt nichts erneut.
  const { prefs } = view({ section: 'sprints', serverLang: 'en' });
  expect(scrolled).toHaveBeenCalledTimes(1);
  act(() => prefs.setLang('de'));
  expect(scrolled).toHaveBeenCalledTimes(1);
});

describe('header actions of a folded section', () => {
  const users = [
    {
      handle: 'ana',
      name: 'Ana',
      kind: 'human' as const,
      admin: false,
      fingerprints: ['SHA256:a'],
    },
  ];
  const cases = () => [
    { section: m.sectionRepositories, action: m.addRepo, dialog: m.addRepoTitle },
    { section: m.sectionProjects, action: m.addProject, dialog: m.addProjectTitle },
    { section: m.sectionSprints, action: m.addSprint, dialog: m.addSprintTitle },
    { section: m.sectionUsers, action: m.addUser, dialog: m.addUserTitle },
    { section: m.sectionUsers, action: m.createAgent, dialog: m.createAgentTitle },
  ];

  test('open their dialogs without unfolding', async () => {
    const user = userEvent.setup();
    view({ me: 'ana', over: { users } });
    for (const { section, action, dialog } of cases()) {
      if (toggle(section).getAttribute('aria-expanded') === 'true') {
        await user.click(toggle(section));
      }
      await user.click(within(region(section)).getByRole('button', { name: action }));
      expect(screen.getByRole('dialog', { name: dialog })).toBeTruthy();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(toggle(section).getAttribute('aria-expanded')).toBe('false');
      // Der Fokus kehrt an den Auslöser im Kopf zurück.
      expect(document.activeElement).toBe(
        within(region(section)).getByRole('button', { name: action }),
      );
    }
  });

  test('checking repositories unfolds the section and shows the result', async () => {
    const user = userEvent.setup();
    view();
    call.mockResolvedValue({ repos: [{ name: 'web', url: 'u', findings: [] }] });
    await user.click(toggle(m.sectionRepositories));
    const repos = () => region(m.sectionRepositories);
    await user.click(within(repos()).getByRole('button', { name: m.checkRepos }));
    expect(call).toHaveBeenCalledWith('repo_check', {});
    expect(toggle(m.sectionRepositories).getAttribute('aria-expanded')).toBe('true');
    expect(within(repos()).getByRole('status').textContent).toBe(m.checkClean);
    expect(within(repos()).getByRole('region', { name: m.checkResults })).toBeTruthy();
  });
});
