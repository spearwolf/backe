import type { BacklogEntryJson, StateJson } from '@backe/ui/api.ts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountApp } from '../../app/bootstrap.tsx';
import { fakeEventSources } from '../../test/fake-event-source.ts';
import { testConfig, testIssue, testState, tid } from '../../test/state.ts';
import { m as b } from '../../views/backlog.messages.ts';
import { m } from '../../views/issue.messages.ts';
import { m as w } from './write.messages.ts';

vi.mock('../../markdown/index.tsx', () => ({
  Markdown: ({ source }: { source: string }) => <div data-testid="markdown">{source}</div>,
}));

const NEW_ID = 'bk-new1';
const PARENT = testIssue(1, { projects: ['api'], sprints: ['s2'], repos: ['core'] });

type Call = { method: string; url: string; body: unknown };
type Answer = (call: Call) => Response | undefined;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const entry = (over: Partial<BacklogEntryJson> = {}): BacklogEntryJson => ({
  name: 'acme',
  current: true,
  can_write: true,
  user: 'spw',
  prefix: 'bk',
  ...over,
});

function backlogState(): StateJson {
  return testState([PARENT, testIssue(2)], {
    config: testConfig({
      props: { prio: { type: 'enum', description: 'Wie dringend', values: ['low', 'high'] } },
    }),
    projects: [
      { path: 'web', title: 'Web' },
      { path: 'api', title: 'API' },
    ] as StateJson['projects'],
    sprints: [
      { slug: 's1', title: 'S1' },
      { slug: 's2', title: 'S2' },
    ] as StateJson['sprints'],
    repos: [{ name: 'core' }] as StateJson['repos'],
    users: [
      { handle: 'spw', name: 'S', kind: 'human' },
      { handle: 'anna', name: 'A', kind: 'human' },
    ] as StateJson['users'],
  });
}

let unmount: (() => void) | undefined;
// jsdom kennt keine Blob-URLs; die Tests zählen, was angelegt und wieder freigegeben wird.
const { createObjectURL, revokeObjectURL } = URL;
const calls: Call[] = [];
const writes = () => calls.filter((c) => c.method !== 'GET');

afterEach(async () => {
  await act(async () => unmount?.());
  unmount = undefined;
  calls.length = 0;
  vi.unstubAllGlobals();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  localStorage.clear();
  document.body.innerHTML = '';
});

async function setup(
  path: string,
  opts: { entry?: Partial<BacklogEntryJson>; answer?: Answer } = {},
) {
  window.history.replaceState(null, '', path);
  const sources = fakeEventSources();
  const fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    const call = { method, url, body };
    calls.push(call);
    const answered = opts.answer?.(call);
    if (answered !== undefined) return answered;
    if (url === '/api/backlogs') return json({ backlogs: [entry(opts.entry)], lang: 'de' });
    if (url === '/api/b/acme/state') return json(backlogState());
    if (url.endsWith('/tools/issue_create')) return json({ commit: null, id: NEW_ID });
    if (method === 'PUT') return json({ commit: null, id: NEW_ID });
    return json({ error: { code: 'not_found', message: 'nope' } }, 404);
  };
  vi.stubGlobal('fetch', fetch);
  const objectUrls: string[] = [];
  const revoked: string[] = [];
  URL.createObjectURL = () => {
    const url = `blob:${objectUrls.length + 1}`;
    objectUrls.push(url);
    return url;
  };
  URL.revokeObjectURL = (u: string) => void revoked.push(u);
  const root = document.createElement('div');
  document.body.append(root);
  await act(async () => {
    unmount = await mountApp(root, { fetch, eventSource: sources.create, win: window });
  });
  const es = sources.all.filter((s) => !s.closed)[0];
  await act(async () => {
    es?.emitOpen();
    es?.emitEvent('hello', { rev: 1, head: 'h1' });
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  return { user: userEvent.setup(), revoked };
}

const dialog = () => screen.getByRole('dialog', { name: w.newIssue });
const queryDialog = () => screen.queryByRole('dialog');
const inDialog = () => within(dialog());
const titleBox = () => inDialog().getByRole('textbox', { name: m.titleLabel }) as HTMLInputElement;
const bodyBox = () =>
  inDialog().getByRole('textbox', { name: m.description }) as HTMLTextAreaElement;
const createButton = () => inDialog().getByRole('button', { name: w.create }) as HTMLButtonElement;
const chips = (label: string) =>
  within(inDialog().getByRole('group', { name: label }))
    .queryAllByRole('listitem')
    .map((li) => li.textContent);

test('c opens the dialog prefilled from the backlog filter', async () => {
  const { user } = await setup(
    '/b/acme/backlog?state=todo&project=web&sprint=s1&repo=core&assignee=me&mode=ready',
  );
  await user.keyboard('c');
  expect(document.activeElement).toBe(titleBox());
  expect(titleBox().value).toBe('');
  expect(chips(m.fieldProjects)).toEqual(['web']);
  expect(chips(m.fieldSprints)).toEqual(['s1']);
  expect(chips(m.fieldRepos)).toEqual(['core']);
  expect(
    (inDialog().getByRole('combobox', { name: m.fieldState }) as HTMLSelectElement).value,
  ).toBe('todo');
  expect(
    inDialog().getByRole('button', { name: m.choice(m.fieldAssignee, 'me (spw)') }),
  ).toBeTruthy();
  // Nur die Hauptlinie: Seitenzustände entstehen per Übergang, nicht beim Anlegen.
  expect(
    within(inDialog().getByRole('combobox', { name: m.fieldState }))
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual(['backlog', 'todo', 'in_progress', 'review', 'done']);
  await user.keyboard('{Escape}');
  expect(queryDialog()).toBeNull();
});

test('c outside the backlog tab starts empty', async () => {
  const { user } = await setup('/b/acme/board?project=web');
  await user.keyboard('c');
  expect(chips(m.fieldProjects)).toEqual([]);
  expect(
    (inDialog().getByRole('combobox', { name: m.fieldState }) as HTMLSelectElement).value,
  ).toBe('backlog');
  expect(inDialog().getByRole('button', { name: m.choice(m.fieldAssignee, 'none') })).toBeTruthy();
});

test('c does nothing while typing or without write access', async () => {
  const { user } = await setup('/b/acme/backlog');
  const search = screen.getByRole('searchbox', { name: b.filterText }) as HTMLInputElement;
  await user.click(search);
  await user.keyboard('c');
  expect(queryDialog()).toBeNull();
  expect(search.value).toBe('c');
  await user.click(document.body);
  await user.keyboard('{Control>}c{/Control}{Meta>}c{/Meta}{Alt>}c{/Alt}');
  expect(queryDialog()).toBeNull();
  // Bei offenem Dialog ist `c` ein Buchstabe im Titel, kein zweiter Dialog.
  await user.keyboard('c');
  await user.keyboard('c');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(titleBox().value).toBe('c');
  await act(async () => unmount?.());

  const readOnly = await setup('/b/acme/backlog', { entry: { can_write: false } });
  await readOnly.user.keyboard('c');
  expect(queryDialog()).toBeNull();
  expect(screen.queryByRole('button', { name: w.newIssue })).toBeNull();
});

test('creating posts issue_create and opens the new tab', async () => {
  const { user } = await setup('/b/acme/backlog?project=web');
  await user.click(screen.getByRole('button', { name: w.newIssue }));
  expect(chips(m.fieldProjects)).toEqual(['web']);
  await user.type(titleBox(), 'Neues Ding');
  // Die Wahl eines Parents übernimmt dessen Listen (BK §2.23).
  await user.type(inDialog().getByRole('combobox', { name: m.parent }), PARENT.id);
  expect(chips(m.fieldProjects)).toEqual(['api']);
  expect(chips(m.fieldSprints)).toEqual(['s2']);
  expect(chips(m.fieldRepos)).toEqual(['core']);
  await user.type(inDialog().getByRole('combobox', { name: m.dependency }), tid(2));
  await user.click(inDialog().getByRole('button', { name: m.addDep }));
  expect(chips(w.dependsOn)).toEqual([tid(2)]);
  await user.selectOptions(inDialog().getByRole('combobox', { name: 'prio' }), 'high');
  expect(inDialog().getByText('Wie dringend')).toBeTruthy();
  await user.click(createButton());

  expect(writes()).toEqual([
    {
      method: 'POST',
      url: '/api/b/acme/tools/issue_create',
      body: {
        title: 'Neues Ding',
        state: 'backlog',
        projects: ['api'],
        sprints: ['s2'],
        repos: ['core'],
        parent: PARENT.id,
        depends_on: [tid(2)],
        props: { prio: 'high' },
      },
    },
  ]);
  await waitFor(() => expect(window.location.pathname).toBe(`/b/acme/issue/${NEW_ID}`));
  expect(queryDialog()).toBeNull();
});

test('without »open after create« the view stays', async () => {
  const { user } = await setup('/b/acme/backlog');
  await user.keyboard('c');
  await user.type(titleBox(), 'Nur anlegen');
  const openAfter = inDialog().getByRole('checkbox', { name: w.openAfter }) as HTMLInputElement;
  expect(openAfter.checked).toBe(true);
  await user.click(openAfter);
  // Enter im Titel legt an wie der Knopf.
  await user.type(titleBox(), '{Enter}');
  await waitFor(() => expect(queryDialog()).toBeNull());
  expect(writes()).toHaveLength(1);
  expect(window.location.pathname).toBe('/b/acme/backlog');
});

test('images upload after the issue exists', async () => {
  const { user, revoked } = await setup('/b/acme/backlog');
  await user.keyboard('c');
  await user.type(titleBox(), 'Mit Bildern');
  const png = (name: string) => new File(['x'], name, { type: 'image/png' });
  fireEvent.paste(bodyBox(), { clipboardData: { files: [png('Shot.png'), png('shot.png')] } });
  await waitFor(() => expect(bodyBox().value).toContain('shot-2.png'));
  expect(bodyBox().value).toBe(
    '![shot.png](attachments/shot.png)\n![shot-2.png](attachments/shot-2.png)',
  );
  // Vor dem Anlegen geht nichts zum Server.
  expect(writes()).toEqual([]);
  await user.click(inDialog().getByRole('button', { name: 'Vorschau' }));
  await user.click(inDialog().getByRole('button', { name: 'Text' }));
  await user.click(createButton());

  await waitFor(() => expect(writes()).toHaveLength(3));
  expect(writes().map((c) => `${c.method} ${c.url}`)).toEqual([
    'POST /api/b/acme/tools/issue_create',
    `PUT /api/b/acme/issues/${NEW_ID}/attachments/shot.png`,
    `PUT /api/b/acme/issues/${NEW_ID}/attachments/shot-2.png`,
  ]);
  expect(writes()[0]?.body).toMatchObject({
    body: expect.stringContaining('attachments/shot-2.png'),
  });
  await waitFor(() => expect(queryDialog()).toBeNull());
  expect(revoked.sort()).toEqual(['blob:1', 'blob:2']);
});

test('an image removed from the text is not uploaded', async () => {
  const { user } = await setup('/b/acme/backlog');
  await user.keyboard('c');
  await user.type(titleBox(), 'Ohne Bild');
  fireEvent.paste(bodyBox(), {
    clipboardData: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(bodyBox().value).toContain('a.png'));
  await user.clear(bodyBox());
  await user.click(createButton());
  await waitFor(() => expect(queryDialog()).toBeNull());
  expect(writes().map((c) => c.method)).toEqual(['POST']);
});

test('a create error stays in the dialog with its hint', async () => {
  const { user } = await setup('/b/acme/backlog', {
    answer: (c) =>
      c.url.endsWith('/tools/issue_create')
        ? json(
            {
              error: { code: 'validation', message: 'Sprint s9 fehlt', hint: 'backe sprint list' },
            },
            400,
          )
        : undefined,
  });
  await user.keyboard('c');
  await user.type(titleBox(), 'Kaputt');
  await user.click(createButton());
  const alert = await within(dialog()).findByRole('alert');
  expect(alert.textContent).toContain('Sprint s9 fehlt');
  expect(alert.textContent).toContain('backe sprint list');
  expect(titleBox().value).toBe('Kaputt');
  expect(window.location.pathname).toBe('/b/acme/backlog');
});

test('a failed upload keeps the dialog and names the created issue', async () => {
  const { user } = await setup('/b/acme/backlog', {
    answer: (c) =>
      c.method === 'PUT'
        ? json({ error: { code: 'too_large', message: 'Zu groß' } }, 413)
        : undefined,
  });
  await user.keyboard('c');
  await user.type(titleBox(), 'Halb');
  fireEvent.paste(bodyBox(), {
    clipboardData: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(bodyBox().value).toContain('a.png'));
  await user.click(createButton());
  const alert = await within(dialog()).findByRole('alert');
  expect(alert.textContent).toContain('Zu groß');
  expect(inDialog().getByText(w.createdUploadFailed(NEW_ID))).toBeTruthy();
  // Das Issue gibt es schon: Ein zweites Anlegen darf es nicht mehr geben.
  expect(inDialog().queryByRole('button', { name: w.create })).toBeNull();
  await user.click(inDialog().getByRole('button', { name: w.dismiss }));
  expect(queryDialog()).toBeNull();
  expect(window.location.pathname).toBe(`/b/acme/issue/${NEW_ID}`);
  expect(writes().filter((c) => c.method === 'POST')).toHaveLength(1);
});

test('the title is required', async () => {
  const { user } = await setup('/b/acme/backlog');
  await user.keyboard('c');
  expect(createButton().disabled).toBe(true);
  await user.type(titleBox(), '   {Enter}');
  expect(createButton().disabled).toBe(true);
  expect(writes()).toEqual([]);
  await user.type(titleBox(), 'x');
  expect(createButton().disabled).toBe(false);
});
