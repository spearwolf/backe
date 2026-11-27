import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatDate } from '../../lib/format.ts';
import { call, region, registerSettingsHarness, view } from '../../test/settings-view.tsx';
import { testIssue, testPatch, tid } from '../../test/state.ts';
import { m } from '../../views/settings.messages.ts';

registerSettingsHarness();

const repos = [
  { name: 'web', url: 'https://example.com/acme/web.git', default_ref: 'main', body: 'Die **UI**' },
  { name: 'core', url: 'https://example.com/acme/core.git' },
];

const section = () => region(m.sectionRepositories);
const items = () =>
  within(within(section()).getByRole('list', { name: m.repoList })).getAllByRole('listitem');
const row = (name: string) =>
  items().find((li) => within(li).queryByRole('link', { name }) !== null) as HTMLElement;

test('repos list name, url, default ref and description', async () => {
  view({ over: { repos } });
  // Nach Name sortiert.
  expect(items().map((li) => within(li).getAllByRole('link')[0]?.textContent)).toEqual([
    'core',
    'web',
  ]);
  const web = row('web');
  const link = within(web).getByRole('link', { name: 'web' });
  expect(link.getAttribute('href')).toBe('/b/acme/backlog?repo=web');
  expect(web.textContent).toContain('https://example.com/acme/web.git');
  expect(web.textContent).toContain('main');
  expect((await within(web).findByText('UI')).tagName).toBe('STRONG');
  expect(row('core').textContent).not.toContain('main');
});

test('without repos there is a note, without write access no actions', () => {
  view({ canWrite: false });
  expect(within(section()).getByText(m.noRepos)).toBeTruthy();
  expect(within(section()).queryByRole('button', { name: m.addRepo })).toBeNull();
  expect(within(section()).queryByRole('button', { name: m.checkRepos })).toBeNull();
});

test('adding a repo sends only filled fields', async () => {
  const user = userEvent.setup();
  view({ over: { repos } });
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(section()).getByRole('button', { name: m.addRepo }));
  const dialog = screen.getByRole('dialog', { name: m.addRepoTitle });
  const add = within(dialog).getByRole('button', { name: m.addRepo }) as HTMLButtonElement;
  // Ohne URL kein Hinzufügen.
  expect(add.disabled).toBe(true);
  await user.type(within(dialog).getByLabelText(m.repoUrl), 'https://example.com/acme/x.git');
  await user.type(within(dialog).getByLabelText(m.repoName), 'xrepo');
  expect(add.disabled).toBe(false);
  await user.click(add);
  expect(call).toHaveBeenCalledWith('repo_add', {
    url: 'https://example.com/acme/x.git',
    name: 'xrepo',
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('adding sends ref and description when filled, Enter confirms', async () => {
  const user = userEvent.setup();
  view();
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(section()).getByRole('button', { name: m.addRepo }));
  const dialog = screen.getByRole('dialog', { name: m.addRepoTitle });
  await user.type(within(dialog).getByLabelText(m.repoRef), 'release/1.0');
  await user.type(within(dialog).getByLabelText(m.repoDescription), 'Text');
  await user.type(within(dialog).getByLabelText(m.repoUrl), 'https://example.com/a.git');
  await user.keyboard('{Enter}');
  expect(call).toHaveBeenCalledWith('repo_add', {
    url: 'https://example.com/a.git',
    ref: 'release/1.0',
    body: 'Text',
  });
});

test('an invalid name or ref blocks adding', async () => {
  const user = userEvent.setup();
  view();
  await user.click(within(section()).getByRole('button', { name: m.addRepo }));
  const dialog = screen.getByRole('dialog', { name: m.addRepoTitle });
  await user.type(within(dialog).getByLabelText(m.repoUrl), 'https://example.com/a.git');
  const add = within(dialog).getByRole('button', { name: m.addRepo }) as HTMLButtonElement;
  const name = within(dialog).getByLabelText(m.repoName);
  await user.type(name, 'Bad Name');
  expect(name.getAttribute('aria-invalid')).toBe('true');
  expect(within(dialog).getByText(m.invalidRepoName)).toBeTruthy();
  expect(add.disabled).toBe(true);
  await user.clear(name);
  expect(add.disabled).toBe(false);
  const ref = within(dialog).getByLabelText(m.repoRef);
  await user.type(ref, 'a..b');
  expect(ref.getAttribute('aria-invalid')).toBe('true');
  expect(within(dialog).getByText(m.invalidRepoRef)).toBeTruthy();
  expect(add.disabled).toBe(true);
  expect(call).not.toHaveBeenCalled();
});

test('removing asks first and is blocked while issues refer to it', async () => {
  const user = userEvent.setup();
  const { store } = view({ over: { repos } });
  act(() => {
    store.applyPatch(
      testPatch(2, {
        upsert: {
          // Ein Verweis mit Ref zählt, der andere Name nicht.
          issues: [testIssue(1, { repos: ['core@main'] }), testIssue(2, { repos: ['web'] })],
        },
      }),
    );
  });
  await user.click(within(row('core')).getByRole('button', { name: m.removeRepoOf('core') }));
  const dialog = screen.getByRole('dialog', { name: m.removeRepoTitle('core') });
  expect(within(dialog).getByText(m.repoStillReferenced)).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: new RegExp(tid(1)) })).toBeTruthy();
  expect(within(dialog).queryByRole('link', { name: new RegExp(tid(2)) })).toBeNull();
  const confirm = within(dialog).getByRole('button', { name: m.removeRepo }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  expect(call).not.toHaveBeenCalled();
});

test('removing an unreferenced repo calls repo_rm', async () => {
  const user = userEvent.setup();
  view({ over: { repos } });
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(row('core')).getByRole('button', { name: m.removeRepoOf('core') }));
  const dialog = screen.getByRole('dialog', { name: m.removeRepoTitle('core') });
  expect(within(dialog).queryByText(m.repoStillReferenced)).toBeNull();
  // Erst die Bestätigung schreibt.
  expect(call).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: m.removeRepo }));
  expect(call).toHaveBeenCalledWith('repo_rm', { name: 'core' });
});

test('check shows findings per repo with their level', async () => {
  const user = userEvent.setup();
  view({ over: { repos } });
  call.mockResolvedValueOnce({
    repos: [
      {
        name: 'core',
        url: 'https://example.com/acme/core.git',
        findings: [
          { level: 'error', kind: 'local', message: 'Kein lokaler Klon' },
          { level: 'warning', kind: 'ref', message: 'Ref fehlt' },
          { level: 'info', kind: 'network', message: 'Erreichbar' },
        ],
        github: { visibility: 'private', archived: true },
        cached: '2026-11-20T10:00:00Z',
      },
      { name: 'web', url: 'https://example.com/acme/web.git', findings: [] },
    ],
    notices: [{ message: 'GitHub nicht erreichbar' }],
  });
  await user.click(within(section()).getByRole('button', { name: m.checkRepos }));
  expect(call).toHaveBeenCalledWith('repo_check', {});
  const results = within(section()).getByRole('region', { name: m.checkResults });
  const core = within(results).getByRole('listitem', { name: 'core' });
  expect(core.textContent).toContain(`${m.levelError}Kein lokaler Klon`);
  expect(core.textContent).toContain(`${m.levelWarning}Ref fehlt`);
  expect(core.textContent).toContain(`${m.levelInfo}Erreichbar`);
  expect(core.textContent).toContain(m.githubInfo('private', true));
  expect(core.textContent).toContain(m.cachedFrom(formatDate('2026-11-20T10:00:00Z')));
  expect(within(results).getByRole('listitem', { name: 'web' }).textContent).toContain(
    m.checkClean,
  );
  expect(results.textContent).toContain('GitHub nicht erreichbar');

  // Mit Remote; ein neuer Lauf ersetzt das Ergebnis.
  call.mockResolvedValueOnce({ repos: [{ name: 'web', url: 'u', findings: [] }] });
  await user.click(within(section()).getByRole('checkbox', { name: m.checkRemote }));
  await user.click(within(section()).getByRole('button', { name: m.checkRepos }));
  expect(call).toHaveBeenLastCalledWith('repo_check', { remote: true });
  const second = within(section()).getByRole('region', { name: m.checkResults });
  expect(within(second).queryByRole('listitem', { name: 'core' })).toBeNull();
  expect(second.textContent).not.toContain('GitHub nicht erreichbar');
});

test('lists follow patches and a dialog of a vanished repo closes', async () => {
  const user = userEvent.setup();
  const { store } = view({ over: { repos } });
  act(() => {
    store.applyPatch(
      testPatch(2, {
        upsert: { repos: [{ name: 'api', url: 'https://example.com/acme/api.git' }] },
      }),
    );
  });
  expect(row('api')).toBeTruthy();
  await user.click(within(row('core')).getByRole('button', { name: m.removeRepoOf('core') }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  act(() => {
    store.applyPatch(testPatch(3, { remove: { repos: ['core'] } }));
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(section()).queryByRole('link', { name: 'core' })).toBeNull();
});

test('the reference list of an open remove dialog follows patches', async () => {
  const user = userEvent.setup();
  const { store } = view({ over: { repos } });
  act(() => {
    store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(1, { repos: ['web'] })] } }));
  });
  await user.click(within(row('core')).getByRole('button', { name: m.removeRepoOf('core') }));
  const dialog = screen.getByRole('dialog', { name: m.removeRepoTitle('core') });
  const confirm = () =>
    within(dialog).getByRole('button', { name: m.removeRepo }) as HTMLButtonElement;
  expect(confirm().disabled).toBe(false);
  // Ein bestehendes Issue nennt das Repo jetzt: Der Dialog sperrt.
  act(() => {
    store.applyPatch(
      testPatch(3, { upsert: { issues: [testIssue(1, { repos: ['core@main'] })] } }),
    );
  });
  expect(within(dialog).getByText(m.repoStillReferenced)).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: new RegExp(tid(1)) })).toBeTruthy();
  expect(confirm().disabled).toBe(true);
  // Und wieder frei.
  act(() => {
    store.applyPatch(testPatch(4, { upsert: { issues: [testIssue(1, { repos: [] })] } }));
  });
  expect(within(dialog).queryByText(m.repoStillReferenced)).toBeNull();
  expect(confirm().disabled).toBe(false);
});

test('without write access rows have no path, remove, check or add', () => {
  view({ canWrite: false, over: { repos } });
  const buttons = within(section())
    .queryAllByRole('button')
    .map((b) => b.textContent);
  // Nur der Klappknopf des Abschnitts.
  expect(buttons).toEqual([m.sectionRepositories]);
  expect(within(section()).queryByRole('checkbox')).toBeNull();
});

test('the remove dialog closes after repo_rm and focus moves to add', async () => {
  const user = userEvent.setup();
  view({ over: { repos } });
  let finish: (v: unknown) => void = () => {};
  call.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await user.click(within(row('core')).getByRole('button', { name: m.removeRepoOf('core') }));
  const dialog = screen.getByRole('dialog', { name: m.removeRepoTitle('core') });
  await user.click(within(dialog).getByRole('button', { name: m.removeRepo }));
  // Während der Aufruf läuft, bleibt der Dialog stehen.
  expect(screen.queryByRole('dialog')).not.toBeNull();
  await act(async () => finish({ commit: 'c1' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  // Der Auslöser verschwindet mit dem Repo: Der Fokus geht an »Hinzufügen«.
  // Radix gibt den Fokus erst im nächsten Tick zurück.
  await waitFor(() =>
    expect(document.activeElement).toBe(within(section()).getByRole('button', { name: m.addRepo })),
  );
});

test('only a short summary of the check is a live region', async () => {
  const user = userEvent.setup();
  view({ over: { repos } });
  call.mockResolvedValueOnce({
    repos: [
      {
        name: 'core',
        url: 'u',
        findings: [
          { level: 'error', kind: 'local', message: 'Kein lokaler Klon' },
          { level: 'info', kind: 'network', message: 'Erreichbar' },
        ],
      },
    ],
  });
  await user.click(within(section()).getByRole('button', { name: m.checkRepos }));
  const status = within(section()).getByRole('status');
  expect(status.textContent).toBe(m.checkFindings(2));
  expect(within(status).queryByRole('listitem')).toBeNull();
  call.mockResolvedValueOnce({ repos: [{ name: 'core', url: 'u', findings: [] }] });
  await user.click(within(section()).getByRole('button', { name: m.checkRepos }));
  expect(within(section()).getByRole('status').textContent).toBe(m.checkClean);
});
