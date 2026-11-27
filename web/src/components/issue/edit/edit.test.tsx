import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  call,
  deferred,
  expectOneCall,
  flush,
  ID,
  registerIssueViewHarness,
  view,
} from '../../../test/issue-view.tsx';
import { testConfig, testIssue, testPatch, tid } from '../../../test/state.ts';
import { m } from '../../../views/issue.messages.ts';

vi.mock('../../../markdown/index.tsx', () => ({
  Markdown: ({ source }: { source: string }) => <div data-testid="markdown">{source}</div>,
}));

registerIssueViewHarness();

const USERS = [
  { handle: 'spw', name: 'Wolf', kind: 'human' as const, admin: true },
  { handle: 'ada', name: 'Ada', kind: 'human' as const, admin: false },
];

const assigneeButton = () =>
  screen.getByRole('button', { name: new RegExp(`^${m.fieldAssignee}: `) }) as HTMLButtonElement;
const menuTexts = (role: 'menuitem' | 'menuitemradio') =>
  screen.getAllByRole(role).map((e) => e.textContent);

test('without write access every editor is missing', async () => {
  view([testIssue(1, { repos: ['core'] }), testIssue(2)], {}, false);
  await flush();
  expect(screen.queryByRole('button', { name: m.editTitle })).toBeNull();
  expect(screen.queryByRole('button', { name: m.changeState })).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('button', { name: new RegExp(`^${m.fieldAssignee}: `) })).toBeNull();
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
  expectOneCall('issue_update', { id: ID, title: 'Neu' });
  await flush();
  expect(screen.queryByRole('textbox', { name: m.titleLabel })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: m.editTitle }));

  await userEvent.click(screen.getByRole('button', { name: m.editTitle }));
  await userEvent.type(screen.getByRole('textbox', { name: m.titleLabel }), 'xyz{Escape}');
  expect(screen.queryByRole('textbox', { name: m.titleLabel })).toBeNull();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Alt');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: m.editTitle }));
  expect(call).not.toHaveBeenCalled();
});

test('assignee, projects, sprints and parent send issue_update', async () => {
  view([testIssue(1, { projects: ['web'], parent: tid(2) }), testIssue(2), testIssue(3)], {
    users: USERS,
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
  expect(assigneeButton().textContent).toBe(m.assigneeNone);
  await userEvent.click(assigneeButton());
  expect(menuTexts('menuitemradio')).toEqual([m.assigneeNone, m.assigneeMe('spw'), 'ada']);
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'ada' }));
  expectOneCall('issue_update', { id: ID, assignee: 'ada' });
  await flush();
  await userEvent.click(assigneeButton());
  await userEvent.click(screen.getByRole('menuitemradio', { name: m.assigneeNone }));
  expect(call).not.toHaveBeenCalled();
  await userEvent.click(assigneeButton());
  await userEvent.click(screen.getByRole('menuitemradio', { name: m.assigneeMe('spw') }));
  expectOneCall('issue_update', { id: ID, assignee: 'spw' });

  await userEvent.click(screen.getByRole('button', { name: m.remove('web') }));
  expectOneCall('issue_update', { id: ID, rm_projects: ['web'] });
  await flush();
  await userEvent.click(screen.getByRole('button', { name: m.addTo(m.fieldProjects) }));
  expect(menuTexts('menuitem')).toEqual(['api']);
  await userEvent.click(screen.getByRole('menuitem', { name: 'api' }));
  expectOneCall('issue_update', { id: ID, add_projects: ['api'] });

  await userEvent.click(screen.getByRole('button', { name: m.addTo(m.fieldSprints) }));
  expect(menuTexts('menuitem')).toEqual(['s1']);
  await userEvent.click(screen.getByRole('menuitem', { name: 's1' }));
  expectOneCall('issue_update', { id: ID, add_sprints: ['s1'] });

  await userEvent.click(screen.getByRole('button', { name: m.removeParent }));
  expectOneCall('issue_update', { id: ID, parent: null });
  await flush();
  await userEvent.type(screen.getByRole('combobox', { name: m.parent }), tid(3));
  await userEvent.click(screen.getByRole('button', { name: m.setParent }));
  expectOneCall('issue_update', { id: ID, parent: tid(3) });
});

test('keyboard navigation in a choice sends nothing until enter', async () => {
  view([testIssue(1)], { users: USERS, projects: [{ path: 'web', title: 'Web' }] });
  await flush();
  assigneeButton().focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('menu')).toBeTruthy();
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();

  screen.getByRole('button', { name: m.addTo(m.fieldProjects) }).focus();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('menu')).toBeTruthy();
  await userEvent.keyboard('{ArrowDown}{Escape}');
  expect(call).not.toHaveBeenCalled();

  assigneeButton().focus();
  await userEvent.keyboard('{ArrowDown}');
  await waitFor(() => expect(document.activeElement?.textContent).toBe(m.assigneeNone));
  await userEvent.keyboard('{ArrowDown}{ArrowDown}');
  expect(document.activeElement?.textContent).toBe('ada');
  expect(call).not.toHaveBeenCalled();
  await userEvent.keyboard('{Enter}');
  expectOneCall('issue_update', { id: ID, assignee: 'ada' });
});

test('a sprint that closes leaves the choice at once', async () => {
  const { store } = view([testIssue(1)], {
    sprints: [
      { slug: 's1', title: 'Sprint 1' },
      { slug: 's2', title: 'Sprint 2' },
    ],
  });
  await flush();
  act(() => {
    store.applyPatch(
      testPatch(2, { upsert: { sprints: [{ slug: 's1', title: 'Sprint 1', closed: true }] } }),
    );
  });
  await userEvent.click(screen.getByRole('button', { name: m.addTo(m.fieldSprints) }));
  expect(menuTexts('menuitem')).toEqual(['s2']);
});

test('dependencies are added and removed', async () => {
  view([testIssue(1, { depends_on: [tid(2)] }), testIssue(2), testIssue(3)]);
  await flush();
  const group = screen.getByRole('region', { name: 'depends_on' });
  await userEvent.click(within(group).getByRole('button', { name: m.remove(tid(2)) }));
  expectOneCall('issue_update', { id: ID, rm_deps: [tid(2)] });
  await flush();
  const input = within(group).getByRole('combobox', { name: m.dependency });
  // Der entfernte Knopf ist weg; der Fokus landet in der Eingabe der Abhängigkeiten.
  expect(document.activeElement).toBe(input);
  const add = within(group).getByRole('button', { name: m.addDep });
  expect((add as HTMLButtonElement).disabled).toBe(true);
  await userEvent.type(input, tid(3));
  await userEvent.click(add);
  expectOneCall('issue_update', { id: ID, add_deps: [tid(3)] });
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
  const inputs = {
    prio,
    flag: screen.getByRole('checkbox', { name: 'flag' }),
    size: screen.getByRole('spinbutton', { name: 'size' }),
    note: screen.getByRole('textbox', { name: 'note' }),
  };
  const help = { prio: 'Wie dringend', flag: 'Ein Schalter', size: 'Größe', note: 'Notiz' };
  for (const [key, input] of Object.entries(inputs)) {
    const id = input.getAttribute('aria-describedby') as string;
    expect(document.getElementById(id)?.textContent).toBe(help[key as keyof typeof help]);
  }
  // Die Auswahl allein schreibt nichts; erst »speichern«.
  await userEvent.selectOptions(prio, 'high');
  expect(call).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: m.save('prio') }));
  expectOneCall('issue_update', { id: ID, props: { prio: 'high' } });
  await userEvent.click(inputs.flag);
  await userEvent.click(screen.getByRole('button', { name: m.save('flag') }));
  expectOneCall('issue_update', { id: ID, props: { flag: true } });
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
  expectOneCall('issue_update', { id: ID, props: { size: 5 } });

  const extra = screen.getByRole('textbox', { name: 'extra' }) as HTMLInputElement;
  expect(extra.value).toBe('{"a":1}');
  await userEvent.click(screen.getByRole('button', { name: m.remove('extra') }));
  expectOneCall('issue_update', { id: ID, props: { extra: null } });

  const add = screen.getByRole('button', { name: m.addProp }) as HTMLButtonElement;
  await userEvent.type(screen.getByRole('textbox', { name: m.propKey }), 'neu');
  await userEvent.type(screen.getByRole('textbox', { name: m.propValue }), '{{x');
  expect(add.disabled).toBe(true);
  await userEvent.clear(screen.getByRole('textbox', { name: m.propValue }));
  await userEvent.type(screen.getByRole('textbox', { name: m.propValue }), '"x"');
  await userEvent.click(add);
  expectOneCall('issue_update', { id: ID, props: { neu: 'x' } });
});

test('a removed property hands focus to the key of a new one', async () => {
  const answer = deferred<unknown>();
  call.mockImplementation(() => answer.promise);
  view([testIssue(1, { props: { extra: 1 } })]);
  await flush();
  await userEvent.click(screen.getByRole('button', { name: m.remove('extra') }));
  expect(screen.queryByRole('textbox', { name: 'extra' })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: m.propKey }));
  await act(async () => answer.resolve({ commit: null, id: ID }));
});

test('a write locks its editor while it runs and gives focus back', async () => {
  const answer = deferred<unknown>();
  call.mockImplementation(() => answer.promise);
  view([testIssue(1)], { users: USERS });
  await flush();
  await userEvent.click(assigneeButton());
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'ada' }));
  expect(assigneeButton().disabled).toBe(true);
  await act(async () => answer.resolve({ commit: null, id: ID }));
  expect(assigneeButton().disabled).toBe(false);
  await waitFor(() => expect(document.activeElement).toBe(assigneeButton()));
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
