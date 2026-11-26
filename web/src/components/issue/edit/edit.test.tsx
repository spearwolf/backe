import type { IssueDetailJson, IssueJson } from '@backe/ui/api.ts';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router, RouterContext } from '../../../app/router.ts';
import { ApiError } from '../../../data/api-client.ts';
import { Store } from '../../../data/store.ts';
import { StoreContext } from '../../../data/store-context.tsx';
import { WriteContext } from '../../../data/write-context.tsx';
import { Writes } from '../../../data/writes.ts';
import { testConfig, testIssue, testPatch, testState, tid } from '../../../test/state.ts';
import { IssueView } from '../../../views/IssueView.tsx';
import { m } from '../../../views/issue.messages.ts';
import { m as w } from '../../write/write.messages.ts';

vi.mock('../../../markdown/index.tsx', () => ({
  Markdown: ({ source }: { source: string }) => <div data-testid="markdown">{source}</div>,
}));

const ID = tid(1);
const call = vi.fn<(name: string, args: unknown) => Promise<unknown>>();

beforeEach(() => {
  call.mockReset();
  call.mockImplementation(async () => ({ commit: null, id: ID }));
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/attachments')) return new Response('[]');
    const id = url.split('/').pop() as string;
    // Die Felder kommen aus dem Store; das Detail liefert nur, was der Tab zusätzlich lädt.
    const { depends_on: _deps, ...issue } = testIssue(Number(id.slice(-4)));
    const detail: IssueDetailJson = { ...issue, comments_count: 0 };
    return new Response(JSON.stringify(detail));
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function view(issues: IssueJson[], over: Parameters<typeof testState>[1] = {}, canWrite = true) {
  window.history.replaceState(null, '', `/b/acme/issue/${ID}`);
  const router = new Router(window);
  const store = new Store();
  store.load(testState(issues, over));
  const writes = new Writes(store, {
    call: call as never,
    upload: vi.fn(),
    refresh: async () => {},
  });
  render(
    <RouterContext.Provider value={router}>
      <StoreContext.Provider value={store}>
        <WriteContext.Provider value={{ backlog: 'acme', canWrite, me: 'spw', writes }}>
          <IssueView backlog="acme" id={ID} onClose={() => {}} />
        </WriteContext.Provider>
      </StoreContext.Provider>
    </RouterContext.Provider>,
  );
  return { store };
}

const flush = () => act(async () => {});
const fields = () => screen.getByText(m.fieldId).closest('dl') as HTMLElement;
const stateField = () => screen.getByText(m.fieldState).parentElement as HTMLElement;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function openStateMenu() {
  await userEvent.click(screen.getByRole('button', { name: m.changeState }));
}

test('without write access every editor is missing', async () => {
  view([testIssue(1, { repos: ['core'] }), testIssue(2)], {}, false);
  await flush();
  expect(screen.queryByRole('button', { name: m.editTitle })).toBeNull();
  expect(screen.queryByRole('button', { name: m.changeState })).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('button', { name: m.localPathOf('core') })).toBeNull();
  expect(screen.queryByRole('button', { name: m.addProp })).toBeNull();
  expect(screen.queryByRole('button', { name: m.addDep })).toBeNull();
});

test('title edits save on enter and cancel on escape', async () => {
  view([testIssue(1, { title: 'Alt' })]);
  await flush();
  await userEvent.click(screen.getByRole('button', { name: m.editTitle }));
  const input = screen.getByRole('textbox', { name: m.titleLabel });
  expect((input as HTMLInputElement).value).toBe('Alt');
  await userEvent.clear(input);
  await userEvent.keyboard('{Enter}');
  expect(call).not.toHaveBeenCalled();
  await userEvent.type(input, 'Neu{Enter}');
  expect(call).toHaveBeenCalledWith('issue_update', { id: ID, title: 'Neu' });
  await flush();
  expect(screen.queryByRole('textbox', { name: m.titleLabel })).toBeNull();

  call.mockClear();
  await userEvent.click(screen.getByRole('button', { name: m.editTitle }));
  await userEvent.type(screen.getByRole('textbox', { name: m.titleLabel }), 'xyz{Escape}');
  expect(screen.queryByRole('textbox', { name: m.titleLabel })).toBeNull();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Alt');
  expect(call).not.toHaveBeenCalled();
});

test('a state change is optimistic and posts issue_move', async () => {
  const answer = deferred<unknown>();
  call.mockImplementation(() => answer.promise);
  view([testIssue(1)]);
  await flush();
  await openStateMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: 'in_progress' }));
  expect(within(stateField()).getByText('in_progress')).toBeTruthy();
  expect(within(stateField()).getByText(w.pending)).toBeTruthy();
  expect(call).toHaveBeenCalledWith('issue_move', { id: ID, to: 'in_progress' });
  await act(async () => answer.resolve({ commit: null, id: ID }));
  expect(within(stateField()).queryByText(w.pending)).toBeNull();
});

test('blocked asks for blocked_by and reason', async () => {
  view([testIssue(1), testIssue(2)]);
  await flush();
  await openStateMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: /blocked/ }));
  const dialog = screen.getByRole('dialog');
  const confirm = within(dialog).getByRole('button', { name: m.confirmState });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  await userEvent.type(within(dialog).getByRole('combobox', { name: m.blockedBy }), tid(2));
  await userEvent.type(within(dialog).getByRole('textbox', { name: m.reason }), 'wartet');
  await userEvent.click(confirm);
  expect(call).toHaveBeenCalledWith('issue_move', {
    id: ID,
    to: 'blocked',
    reason: 'wartet',
    blocked_by: [tid(2)],
  });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a resume uses issue_resume, a settled issue issue_reopen', async () => {
  view([
    testIssue(1, { state: 'blocked', paused_from: 'in_progress', blocked_by: [tid(2)] }),
    testIssue(2),
  ]);
  await flush();
  await openStateMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: 'in_progress' }));
  expect(call).toHaveBeenCalledWith('issue_resume', { id: ID });
  cleanup();

  view([testIssue(1, { state: 'done' })]);
  await flush();
  await openStateMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: m.withReason }));
  await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(2));
  const sub = screen.getAllByRole('menu')[1] as HTMLElement;
  await userEvent.click(within(sub).getByRole('menuitem', { name: 'todo' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.type(within(dialog).getByRole('textbox', { name: m.reason }), 'nochmal');
  await userEvent.click(within(dialog).getByRole('button', { name: m.confirmState }));
  expect(call).toHaveBeenLastCalledWith('issue_reopen', { id: ID, to: 'todo', reason: 'nochmal' });
});

test('a rejected move rolls back and shows the hint', async () => {
  call.mockRejectedValue(
    new ApiError(400, 'invariant', 'Nicht erlaubt', 'backe issue move --force'),
  );
  view([testIssue(1)]);
  await flush();
  await openStateMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: 'review' }));
  await flush();
  expect(within(stateField()).getByText('todo')).toBeTruthy();
  expect(within(stateField()).getByText('Nicht erlaubt')).toBeTruthy();
  expect(within(stateField()).getByText('backe issue move --force')).toBeTruthy();
});

test('done with open sub-issues offers force', async () => {
  call.mockRejectedValueOnce(
    new ApiError(400, 'invariant', 'Offene Sub-Issues', 'mit --force abschließen', {
      reason: 'open_children',
      ids: [tid(2)],
    }),
  );
  view([testIssue(1, { state: 'review' }), testIssue(2, { title: 'Kind', parent: ID })]);
  await flush();
  await openStateMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: 'done' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('link', { name: /Kind/ })).toBeTruthy();
  expect(within(stateField()).getByText('review')).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: m.forceDone }));
  expect(call).toHaveBeenLastCalledWith('issue_move', { id: ID, to: 'done', force: true });
});

test('assignee, projects, sprints and parent send issue_update', async () => {
  view([testIssue(1, { projects: ['web'], parent: tid(2) }), testIssue(2), testIssue(3)], {
    users: [
      { handle: 'spw', name: 'Wolf', kind: 'human', admin: true },
      { handle: 'ada', name: 'Ada', kind: 'human', admin: false },
    ],
    projects: [
      { path: 'web', title: 'Web' },
      { path: 'api', title: 'API' },
    ],
    sprints: [
      { slug: 's1', title: 'Sprint 1' },
      { slug: 's0', title: 'Alt', closed: true },
    ],
  });
  await flush();
  const assignee = within(fields()).getByRole('combobox', { name: m.fieldAssignee });
  expect(
    within(assignee)
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual(['none', 'me (spw)', 'ada']);
  await userEvent.selectOptions(assignee, 'ada');
  expect(call).toHaveBeenLastCalledWith('issue_update', { id: ID, assignee: 'ada' });
  await userEvent.selectOptions(assignee, 'spw');
  expect(call).toHaveBeenLastCalledWith('issue_update', { id: ID, assignee: 'spw' });

  await userEvent.click(screen.getByRole('button', { name: m.remove('web') }));
  expect(call).toHaveBeenLastCalledWith('issue_update', { id: ID, rm_projects: ['web'] });
  await flush();
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: m.addTo(m.fieldProjects) }),
    'api',
  );
  expect(call).toHaveBeenLastCalledWith('issue_update', { id: ID, add_projects: ['api'] });

  const sprints = screen.getByRole('combobox', { name: m.addTo(m.fieldSprints) });
  expect(within(sprints).queryByRole('option', { name: 's0' })).toBeNull();
  await userEvent.selectOptions(sprints, 's1');
  expect(call).toHaveBeenLastCalledWith('issue_update', { id: ID, add_sprints: ['s1'] });

  await userEvent.click(screen.getByRole('button', { name: m.removeParent }));
  expect(call).toHaveBeenLastCalledWith('issue_update', { id: ID, parent: null });
  await flush();
  await userEvent.type(screen.getByRole('combobox', { name: m.parent }), tid(3));
  await userEvent.click(screen.getByRole('button', { name: m.setParent }));
  expect(call).toHaveBeenLastCalledWith('issue_update', { id: ID, parent: tid(3) });
});

test('dependencies are added and removed', async () => {
  view([testIssue(1, { depends_on: [tid(2)] }), testIssue(2), testIssue(3)]);
  await flush();
  const group = screen.getByRole('region', { name: 'depends_on' });
  await userEvent.click(within(group).getByRole('button', { name: m.remove(tid(2)) }));
  expect(call).toHaveBeenLastCalledWith('issue_update', { id: ID, rm_deps: [tid(2)] });
  await flush();
  const add = within(group).getByRole('button', { name: m.addDep });
  expect((add as HTMLButtonElement).disabled).toBe(true);
  await userEvent.type(within(group).getByRole('combobox', { name: m.dependency }), tid(3));
  await userEvent.click(add);
  expect(call).toHaveBeenLastCalledWith('issue_update', { id: ID, add_deps: [tid(3)] });
});

test('declared properties get typed inputs with their description', async () => {
  view([testIssue(1)], {
    config: testConfig({
      props: {
        prio: { type: 'enum', values: ['low', 'high'], description: 'Wie dringend' },
        flag: { type: 'boolean', description: 'Ein Schalter' },
        size: { type: 'integer', description: 'Größe' },
        note: { type: 'string', description: 'Notiz' },
      },
    }),
  });
  await flush();
  const prio = screen.getByRole('combobox', { name: 'prio' });
  expect(
    within(prio)
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual(['', 'low', 'high']);
  expect(screen.getByRole('checkbox', { name: 'flag' })).toBeTruthy();
  expect(screen.getByRole('spinbutton', { name: 'size' })).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'note' })).toBeTruthy();
  for (const text of ['Wie dringend', 'Ein Schalter', 'Größe', 'Notiz']) {
    expect(screen.getByText(text)).toBeTruthy();
  }
  await userEvent.selectOptions(prio, 'high');
  await userEvent.click(screen.getByRole('button', { name: m.save('prio') }));
  expect(call).toHaveBeenLastCalledWith('issue_update', { id: ID, props: { prio: 'high' } });
  await userEvent.click(screen.getByRole('checkbox', { name: 'flag' }));
  await userEvent.click(screen.getByRole('button', { name: m.save('flag') }));
  expect(call).toHaveBeenLastCalledWith('issue_update', { id: ID, props: { flag: true } });
});

test('properties are set, changed and removed', async () => {
  view([testIssue(1, { props: { size: 3, extra: { a: 1 } } })], {
    config: testConfig({ props: { size: { type: 'integer', description: 'Größe' } } }),
  });
  await flush();
  const size = screen.getByRole('spinbutton', { name: 'size' }) as HTMLInputElement;
  expect(size.value).toBe('3');
  await userEvent.clear(size);
  expect((screen.getByRole('button', { name: m.save('size') }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await userEvent.type(size, '5{Enter}');
  expect(call).toHaveBeenLastCalledWith('issue_update', { id: ID, props: { size: 5 } });

  const extra = screen.getByRole('textbox', { name: 'extra' }) as HTMLInputElement;
  expect(extra.value).toBe('{"a":1}');
  await userEvent.click(screen.getByRole('button', { name: m.remove('extra') }));
  expect(call).toHaveBeenLastCalledWith('issue_update', { id: ID, props: { extra: null } });

  const add = screen.getByRole('button', { name: m.addProp }) as HTMLButtonElement;
  await userEvent.type(screen.getByRole('textbox', { name: m.propKey }), 'neu');
  await userEvent.type(screen.getByRole('textbox', { name: m.propValue }), '{{x');
  expect(add.disabled).toBe(true);
  await userEvent.clear(screen.getByRole('textbox', { name: m.propValue }));
  await userEvent.type(screen.getByRole('textbox', { name: m.propValue }), '"x"');
  await userEvent.click(add);
  expect(call).toHaveBeenLastCalledWith('issue_update', { id: ID, props: { neu: 'x' } });
});

test('a write locks its editor while it runs', async () => {
  const answer = deferred<unknown>();
  call.mockImplementation(() => answer.promise);
  view([testIssue(1)], {
    users: [{ handle: 'ada', name: 'Ada', kind: 'human', admin: false }],
  });
  await flush();
  const assignee = screen.getByRole('combobox', { name: m.fieldAssignee }) as HTMLSelectElement;
  await userEvent.selectOptions(assignee, 'ada');
  expect(assignee.disabled).toBe(true);
  await act(async () => answer.resolve({ commit: null, id: ID }));
  expect(assignee.disabled).toBe(false);
});

test('a deleted issue keeps its data but loses its editors', async () => {
  const { store } = view([testIssue(1, { title: 'Weg damit' })]);
  await flush();
  expect(screen.getByRole('button', { name: m.editTitle })).toBeTruthy();
  act(() => {
    store.applyPatch(testPatch(2, { remove: { issues: [ID] } }));
  });
  await flush();
  expect(screen.getByText(m.deletedNotice)).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1, name: 'Weg damit' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: m.editTitle })).toBeNull();
  expect(screen.queryByRole('button', { name: m.changeState })).toBeNull();
});
