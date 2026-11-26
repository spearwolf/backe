import { screen, waitFor, within } from '@testing-library/react';
import {
  chips,
  createButton,
  dialog,
  inDialog,
  json,
  NEW_ID,
  PARENT,
  queryDialog,
  registerCreateHarness,
  setup,
  teardown,
  titleBox,
  writes,
} from '../../test/create-issue.tsx';
import { tid } from '../../test/state.ts';
import { m as b } from '../../views/backlog.messages.ts';
import { m } from '../../views/issue.messages.ts';
import { m as w } from './write.messages.ts';

vi.mock('../../markdown/index.tsx', () => ({
  Markdown: ({ source }: { source: string }) => <div data-testid="markdown">{source}</div>,
}));

registerCreateHarness();

const stateBox = () =>
  inDialog().getByRole('combobox', { name: m.fieldState }) as HTMLSelectElement;

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
  expect(stateBox().value).toBe('todo');
  expect(
    inDialog().getByRole('button', { name: m.choice(m.fieldAssignee, m.assigneeMe('spw')) }),
  ).toBeTruthy();
  // Nur die Hauptlinie: Seitenzustände entstehen per Übergang, nicht beim Anlegen.
  expect(
    within(stateBox())
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual(['backlog', 'todo', 'in_progress', 'review', 'done']);
  // Der Titel ist der Name des Dialogs; eine Beschreibung, die ihn wiederholt, gibt es nicht.
  expect(dialog().hasAttribute('aria-describedby')).toBe(false);
  await user.keyboard('{Escape}');
  expect(queryDialog()).toBeNull();
});

test('c outside the backlog tab starts empty', async () => {
  const { user } = await setup('/b/acme/board?project=web');
  await user.keyboard('c');
  expect(chips(m.fieldProjects)).toEqual([]);
  expect(stateBox().value).toBe('backlog');
  expect(
    inDialog().getByRole('button', { name: m.choice(m.fieldAssignee, m.assigneeNone) }),
  ).toBeTruthy();
});

test('c does nothing while typing or without write access', async () => {
  const { user } = await setup('/b/acme/backlog');
  const search = screen.getByRole('searchbox', { name: b.filterText }) as HTMLInputElement;
  await user.click(search);
  await user.keyboard('c');
  expect(queryDialog()).toBeNull();
  expect(search.value).toBe('c');

  // Ein Textfeld und eine editierbare Fläche außerhalb der App zählen genauso als Tippen.
  const area = document.createElement('textarea');
  const editable = document.createElement('div');
  // jsdom kennt die Eigenschaft `contentEditable` nicht, nur das Attribut.
  editable.setAttribute('contenteditable', 'true');
  editable.tabIndex = 0;
  document.body.append(area, editable);
  await user.click(area);
  await user.keyboard('c');
  expect(area.value).toBe('c');
  editable.focus();
  await user.keyboard('c');
  expect(queryDialog()).toBeNull();

  await user.click(document.body);
  await user.keyboard('{Control>}c{/Control}{Meta>}c{/Meta}{Alt>}c{/Alt}{Shift>}c{/Shift}');
  expect(queryDialog()).toBeNull();

  // Im offenen Menü ist `c` die Typeahead-Suche.
  await user.click(screen.getByRole('button', { name: /^Sprint/ }));
  expect(screen.getByRole('menu')).toBeTruthy();
  await user.keyboard('c');
  expect(queryDialog()).toBeNull();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();

  // Bei offenem Dialog ist `c` ein Buchstabe im Titel, kein zweiter Dialog.
  await user.click(document.body);
  await user.keyboard('c');
  await user.keyboard('c');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(titleBox().value).toBe('c');
  await teardown();

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

test('the same parent again keeps the edited lists', async () => {
  const { user } = await setup('/b/acme/backlog');
  await user.keyboard('c');
  await user.type(titleBox(), 'Kind');
  const parent = inDialog().getByRole('combobox', { name: m.parent });
  await user.type(parent, PARENT.id);
  await user.click(inDialog().getByRole('button', { name: m.remove('api') }));
  // Leerzeichen und Rücktaste melden dieselbe ID noch einmal, wie es auch die Vorschlagsliste tut.
  await user.type(parent, ' {Backspace}');
  expect(chips(m.fieldProjects)).toEqual([]);
  expect(chips(m.fieldSprints)).toEqual(['s2']);
  await user.click(createButton());
  expect(writes()[0]?.body).toMatchObject({ parent: PARENT.id, projects: [], sprints: ['s2'] });
});

test('an invalid property blocks creating', async () => {
  const { user } = await setup('/b/acme/backlog');
  await user.keyboard('c');
  await user.type(titleBox(), 'Mit Punkten');
  const size = inDialog().getByRole('spinbutton', { name: 'size' });
  await user.type(size, '1.5');
  expect(createButton().disabled).toBe(true);
  await user.type(titleBox(), '{Enter}');
  expect(writes()).toEqual([]);
  await user.clear(size);
  expect(createButton().disabled).toBe(false);
  await user.type(size, '3');
  await user.click(createButton());
  expect(writes()[0]?.body).toMatchObject({ props: { size: 3 } });
});

test('a checkbox unchecked again leaves the property unset', async () => {
  const { user } = await setup('/b/acme/backlog');
  await user.keyboard('c');
  await user.type(titleBox(), 'Ohne Haken');
  const flag = inDialog().getByRole('checkbox', { name: 'flag' });
  await user.click(flag);
  await user.click(flag);
  await user.click(createButton());
  expect(writes()[0]?.body).not.toHaveProperty('props');
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
