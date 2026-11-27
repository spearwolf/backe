import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { call, region, registerSettingsHarness, view } from '../../test/settings-view.tsx';
import { testIssue, testPatch, tid } from '../../test/state.ts';
import { m } from '../../views/settings.messages.ts';

registerSettingsHarness();

const projects = [
  { path: 'web', title: 'Web', lead: 'ada', body: 'Die **Oberfläche**' },
  { path: 'web/auth', title: 'Auth' },
  { path: 'api', title: 'API' },
];
const users = [
  { handle: 'ada', name: 'Ada', kind: 'human' as const, admin: false },
  { handle: 'bob', name: 'Bob', kind: 'human' as const, admin: false },
];

const section = () => region(m.sectionProjects);
const list = () => within(section()).getByRole('list', { name: m.projectList });
const row = (path: string) => within(list()).getByRole('listitem', { name: path });

test('projects show as a tree with lead and open issues', async () => {
  view({
    over: {
      projects,
      users,
      issues: [
        testIssue(1, { projects: ['web/auth'] }),
        testIssue(2, { projects: ['web/auth'], state: 'done' }),
      ],
    },
  });
  // Pfadordnung: das Unterprojekt direkt unter seinem Elternteil, eingerückt.
  expect(
    within(list())
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('aria-label')),
  ).toEqual(['api', 'web', 'web/auth']);
  const web = row('web');
  const link = within(web).getByRole('link', { name: 'Web' });
  expect(link.getAttribute('href')).toBe('/b/acme/backlog?project=web');
  expect(web.textContent).toContain(m.projectLead('ada'));
  // Rekursiv: Das offene Issue in `web/auth` zählt auch für `web`.
  expect(web.textContent).toContain(m.openIssues(1));
  expect(row('web/auth').textContent).toContain(m.openIssues(1));
  expect(row('api').textContent).toContain(m.openIssues(0));
  expect(row('api').textContent).not.toContain('Lead');
  expect((await within(web).findByText('Oberfläche')).tagName).toBe('STRONG');
  expect(row('web/auth').style.marginLeft).not.toBe(row('web').style.marginLeft);
});

test('open counts follow issue patches', () => {
  const { store } = view({ over: { projects } });
  expect(row('api').textContent).toContain(m.openIssues(0));
  act(() => {
    store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(1, { projects: ['api'] })] } }));
  });
  expect(row('api').textContent).toContain(m.openIssues(1));
  act(() => {
    store.applyPatch(
      testPatch(3, { upsert: { issues: [testIssue(1, { projects: ['api'], state: 'done' })] } }),
    );
  });
  expect(row('api').textContent).toContain(m.openIssues(0));
});

test('without projects there is a note', () => {
  view();
  expect(within(section()).getByText(m.noProjects)).toBeTruthy();
});

test('without write access there are no actions', () => {
  view({ canWrite: false, over: { projects } });
  const buttons = within(section())
    .queryAllByRole('button')
    .map((b) => b.textContent);
  // Nur der Klappknopf des Abschnitts.
  expect(buttons).toEqual([m.sectionProjects]);
});

test('adding a project sends path, title, lead and description', async () => {
  const user = userEvent.setup();
  view({ over: { projects, users } });
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(section()).getByRole('button', { name: m.addProject }));
  const dialog = screen.getByRole('dialog', { name: m.addProjectTitle });
  const add = within(dialog).getByRole('button', { name: m.addProject }) as HTMLButtonElement;
  // Ohne Pfad kein Anlegen.
  expect(add.disabled).toBe(true);
  const path = within(dialog).getByLabelText(m.projectPath);
  await user.type(path, 'Bad Path');
  expect(path.getAttribute('aria-invalid')).toBe('true');
  expect(within(dialog).getByText(m.invalidProjectPath)).toBeTruthy();
  expect(add.disabled).toBe(true);
  await user.clear(path);
  await user.type(path, 'docs');
  await user.type(within(dialog).getByLabelText(m.fieldTitle), 'Doku');
  await user.selectOptions(within(dialog).getByLabelText(m.projectLeadLabel), 'bob');
  await user.type(within(dialog).getByLabelText(m.projectDescription), 'Text');
  expect(add.disabled).toBe(false);
  await user.click(add);
  expect(call).toHaveBeenCalledWith('project_create', {
    path: 'docs',
    title: 'Doku',
    lead: 'bob',
    body: 'Text',
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('the lead offers nobody and the users', async () => {
  const user = userEvent.setup();
  view({ over: { users } });
  await user.click(within(section()).getByRole('button', { name: m.addProject }));
  const lead = within(screen.getByRole('dialog')).getByLabelText(
    m.projectLeadLabel,
  ) as HTMLSelectElement;
  expect([...lead.options].map((o) => o.textContent)).toEqual([m.leadNone, 'ada', 'bob']);
  expect(lead.value).toBe('');
});

test('creating a sub-project prefills its parent path', async () => {
  const user = userEvent.setup();
  view({ over: { projects } });
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(row('web')).getByRole('button', { name: m.addSubprojectOf('web') }));
  const dialog = screen.getByRole('dialog', { name: m.addProjectTitle });
  const path = within(dialog).getByLabelText(m.projectPath) as HTMLInputElement;
  expect(path.value).toBe('web/');
  // Der unfertige Pfad sperrt, ohne schon als Fehler zu gelten.
  expect(path.getAttribute('aria-invalid')).toBe('false');
  await user.type(path, 'ui');
  await user.type(within(dialog).getByLabelText(m.fieldTitle), 'UI');
  await user.keyboard('{Enter}');
  // Leere optionale Felder gehen nicht mit.
  expect(call).toHaveBeenCalledWith('project_create', { path: 'web/ui', title: 'UI' });
});

test('moving a project sends from and to', async () => {
  const user = userEvent.setup();
  view({ over: { projects } });
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(row('api')).getByRole('button', { name: m.moveProjectOf('api') }));
  const dialog = screen.getByRole('dialog', { name: m.moveProjectTitle('api') });
  const to = within(dialog).getByLabelText(m.moveTo) as HTMLInputElement;
  const move = within(dialog).getByRole('button', { name: m.moveProject }) as HTMLButtonElement;
  // Vorbelegt mit dem alten Pfad: so noch kein Verschieben.
  expect(to.value).toBe('api');
  expect(move.disabled).toBe(true);
  await user.clear(to);
  await user.type(to, 'Bad');
  expect(within(dialog).getByText(m.invalidProjectPath)).toBeTruthy();
  expect(move.disabled).toBe(true);
  await user.clear(to);
  await user.type(to, 'backend');
  expect(move.disabled).toBe(false);
  await user.click(move);
  expect(call).toHaveBeenCalledWith('project_mv', { from: 'api', to: 'backend' });
  expect(screen.queryByRole('dialog')).toBeNull();
  // Die Zeile zieht unter neuem Pfad um; der Fokus geht an »Hinzufügen«.
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(section()).getByRole('button', { name: m.addProject }),
    ),
  );
});

test('a project with sub-projects cannot be removed', () => {
  view({ over: { projects } });
  expect(within(row('web')).queryByRole('button', { name: m.removeProjectOf('web') })).toBeNull();
  expect(
    within(row('web/auth')).getByRole('button', { name: m.removeProjectOf('web/auth') }),
  ).toBeTruthy();
});

test('removing an unreferenced project calls project_rm', async () => {
  const user = userEvent.setup();
  view({ over: { projects } });
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(row('api')).getByRole('button', { name: m.removeProjectOf('api') }));
  const dialog = screen.getByRole('dialog', { name: m.removeProjectTitle('api') });
  expect(within(dialog).queryByText(m.projectStillReferenced)).toBeNull();
  expect(call).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: m.removeProject }));
  expect(call).toHaveBeenCalledWith('project_rm', { path: 'api' });
});

test('removing a referenced project needs reassign or detach', async () => {
  const user = userEvent.setup();
  view({
    over: {
      projects,
      issues: [testIssue(1, { projects: ['web/auth'] }), testIssue(2, { projects: ['web'] })],
    },
  });
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(
    within(row('web/auth')).getByRole('button', { name: m.removeProjectOf('web/auth') }),
  );
  const dialog = screen.getByRole('dialog', { name: m.removeProjectTitle('web/auth') });
  expect(within(dialog).getByText(m.projectStillReferenced)).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: new RegExp(tid(1)) })).toBeTruthy();
  expect(within(dialog).queryByRole('link', { name: new RegExp(tid(2)) })).toBeNull();
  const confirm = within(dialog).getByRole('button', {
    name: m.removeProject,
  }) as HTMLButtonElement;
  // Gesperrt bis zur Wahl.
  expect(confirm.disabled).toBe(true);
  const target = within(dialog).getByLabelText(m.chooseProject) as HTMLSelectElement;
  // Die anderen Projekte, nicht das zu entfernende.
  expect([...target.options].map((o) => o.value)).toEqual(['', 'api', 'web']);
  await user.click(within(dialog).getByRole('radio', { name: m.reassignTo }));
  expect(confirm.disabled).toBe(true);
  await user.selectOptions(target, 'api');
  expect(confirm.disabled).toBe(false);
  // Lösen braucht kein Ziel.
  await user.click(within(dialog).getByRole('radio', { name: m.detach }));
  expect(confirm.disabled).toBe(false);
  await user.click(within(dialog).getByRole('radio', { name: m.reassignTo }));
  await user.click(confirm);
  expect(call).toHaveBeenCalledWith('project_rm', { path: 'web/auth', reassign: 'api' });
});

test('detaching sends detach', async () => {
  const user = userEvent.setup();
  view({ over: { projects, issues: [testIssue(1, { projects: ['api'] })] } });
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(row('api')).getByRole('button', { name: m.removeProjectOf('api') }));
  const dialog = screen.getByRole('dialog', { name: m.removeProjectTitle('api') });
  await user.click(within(dialog).getByRole('radio', { name: m.detach }));
  await user.click(within(dialog).getByRole('button', { name: m.removeProject }));
  expect(call).toHaveBeenCalledWith('project_rm', { path: 'api', detach: true });
});

test('the reference list of an open remove dialog follows patches', async () => {
  const user = userEvent.setup();
  const { store } = view({ over: { projects } });
  await user.click(within(row('api')).getByRole('button', { name: m.removeProjectOf('api') }));
  const dialog = screen.getByRole('dialog', { name: m.removeProjectTitle('api') });
  const confirm = () =>
    within(dialog).getByRole('button', { name: m.removeProject }) as HTMLButtonElement;
  expect(confirm().disabled).toBe(false);
  act(() => {
    store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(1, { projects: ['api'] })] } }));
  });
  expect(within(dialog).getByText(m.projectStillReferenced)).toBeTruthy();
  expect(confirm().disabled).toBe(true);
  // Ein neues Unterprojekt sperrt das Entfernen sicher.
  act(() => {
    store.applyPatch(
      testPatch(3, {
        upsert: { issues: [testIssue(1)], projects: [{ path: 'api/v2', title: 'V2' }] },
      }),
    );
  });
  expect(within(dialog).getByText(m.projectHasChildren)).toBeTruthy();
  expect(confirm().disabled).toBe(true);
});

test('dialogs of a vanished project close', async () => {
  const user = userEvent.setup();
  const { store } = view({ over: { projects } });
  await user.click(within(row('api')).getByRole('button', { name: m.moveProjectOf('api') }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  act(() => {
    store.applyPatch(testPatch(2, { remove: { projects: ['api'] } }));
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(list()).queryByRole('listitem', { name: 'api' })).toBeNull();
});

test('after removing, focus moves to add', async () => {
  const user = userEvent.setup();
  view({ over: { projects } });
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(row('api')).getByRole('button', { name: m.removeProjectOf('api') }));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: m.removeProject }),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(section()).getByRole('button', { name: m.addProject }),
    ),
  );
});
