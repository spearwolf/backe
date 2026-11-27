import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readDepPrefs } from '../../app/dep-prefs.ts';
import {
  flush,
  ID,
  registerReadIssueViewHarness,
  served,
  view,
} from '../../test/read-issue-view.tsx';
import { testIssue, testPatch, tid } from '../../test/state.ts';
import { flushFrames, installXyflowStubs } from '../../test/xyflow.ts';
import { m } from '../../views/deps.messages.ts';
import { m as issueText } from '../../views/issue.messages.ts';

// jsdom kennt kein `IntersectionObserver`: Der Abschnitt gilt sofort als sichtbar, und der
// Graph-Chunk lädt gleich. Das Laden hinter dem Beobachter prüft `DependencySection.lazy.test.tsx`.
registerReadIssueViewHarness();

let uninstall: () => void;
beforeEach(() => {
  uninstall = installXyflowStubs();
});
afterEach(() => {
  // Erst abbauen, dann die Stubs zurück: xyflow räumt beim Unmount noch mit ihnen auf.
  cleanup();
  uninstall();
  localStorage.clear();
});

// tid(4) → tid(3) → tid(2) → ID → tid(5): tid(4) liegt jenseits der Default-Tiefe.
const chain = () => [
  testIssue(1, { depends_on: [tid(2)] }),
  testIssue(2, { depends_on: [tid(3)] }),
  testIssue(3, { depends_on: [tid(4)] }),
  testIssue(4),
  testIssue(5, { depends_on: [ID] }),
];

const region = () => screen.queryByRole('region', { name: m.title });
const fold = () => screen.getByRole('button', { name: m.title });
const node = (id: string) => document.querySelector<HTMLElement>(`[data-dep-node="${id}"]`);
const edge = (id: string) => document.querySelector(`.react-flow__edge[data-id="${id}"]`);

/** Wartet, bis der Graph-Chunk da ist und xyflow vermessen und eingepasst hat. */
async function graphShown() {
  await waitFor(() => expect(node(ID)).not.toBeNull());
  await act(async () => flushFrames());
}

test('no section without dependency edges', async () => {
  view([testIssue(1, { parent: tid(2) }), testIssue(2), testIssue(3, { parent: ID })]);
  await flush();
  expect(screen.getByRole('heading', { level: 1, name: 'Issue 1' })).toBeTruthy();
  expect(region()).toBeNull();
});

test('the section opens with the graph by default', async () => {
  served.comments = [{ file: 'a.md', author: 'ada', created: '2026-11-18T10:00:00Z', body: 'hi' }];
  view(chain());
  await graphShown();
  // Nach den Anhängen, vor der Zeitleiste.
  const timeline = await screen.findByRole('region', { name: issueText.timeline });
  expect(
    (region() as HTMLElement).compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(fold().getAttribute('aria-expanded')).toBe('true');
  expect(node(ID)?.getAttribute('aria-current')).toBe('true');
  expect(node(tid(2))).not.toBeNull();
  expect(node(tid(5))).not.toBeNull();
  expect(screen.getByRole('button', { name: m.viewGraph }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByRole('button', { name: m.viewTree }).getAttribute('aria-pressed')).toBe(
    'false',
  );
  expect((screen.getByRole('checkbox', { name: m.showParents }) as HTMLInputElement).checked).toBe(
    false,
  );
});

test('folding and the tree view are remembered per backlog', async () => {
  view(chain());
  await graphShown();
  await userEvent.click(fold());
  expect(fold().getAttribute('aria-expanded')).toBe('false');
  expect(node(ID)).toBeNull();
  // Zugeklappt nur der Kopf: kein Umschalter, keine Checkbox.
  expect(screen.queryByRole('button', { name: m.viewTree })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: m.showParents })).toBeNull();
  expect(readDepPrefs('acme')).toEqual({ open: false, view: 'graph', parents: false });

  // Neu gemountet: Der Abschnitt bleibt zu.
  cleanup();
  view(chain());
  await flush();
  expect(fold().getAttribute('aria-expanded')).toBe('false');
  expect(node(ID)).toBeNull();

  await userEvent.click(fold());
  await userEvent.click(await screen.findByRole('button', { name: m.viewTree }));
  expect(await screen.findByRole('list', { name: m.prerequisites })).toBeTruthy();
  expect(screen.getByRole('list', { name: m.dependents })).toBeTruthy();
  expect(node(ID)).toBeNull();
  expect(screen.getByRole('button', { name: m.viewTree }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(readDepPrefs('acme')).toEqual({ open: true, view: 'tree', parents: false });
  expect(readDepPrefs('other')).toEqual({ open: true, view: 'graph', parents: false });
});

test('parent links show sub-issues', async () => {
  view([...chain(), testIssue(6, { parent: ID })]);
  await graphShown();
  expect(node(tid(6))).toBeNull();
  await userEvent.click(screen.getByRole('checkbox', { name: m.showParents }));
  await waitFor(() => expect(node(tid(6))).not.toBeNull());
  await act(async () => flushFrames());
  expect(edge(`${tid(6)}>${ID}:parent`)).not.toBeNull();
  expect(readDepPrefs('acme').parents).toBe(true);
});

test('the section follows patches live', async () => {
  const { store } = view(chain());
  await graphShown();
  expect(within(node(tid(2)) as HTMLElement).getByText('Issue 2')).toBeTruthy();

  await act(async () => {
    store.applyPatch(
      testPatch(2, {
        upsert: { issues: [testIssue(2, { title: 'Umbenannt', depends_on: [tid(3)] })] },
      }),
    );
  });
  await act(async () => flushFrames());
  expect(within(node(tid(2)) as HTMLElement).getByText('Umbenannt')).toBeTruthy();

  await act(async () => {
    store.applyPatch(testPatch(3, { upsert: { issues: [testIssue(1)] } }));
  });
  await act(async () => flushFrames());
  expect(node(tid(2))).toBeNull();
  expect(node(tid(5))).not.toBeNull();

  // Die letzte Kante geht: Der Abschnitt verschwindet.
  await act(async () => {
    store.applyPatch(testPatch(4, { upsert: { issues: [testIssue(5)] } }));
  });
  expect(region()).toBeNull();
});

test('a deleted issue drops the section, though others still point at it', async () => {
  const { store } = view(chain());
  await graphShown();
  await act(async () => {
    store.applyPatch(testPatch(2, { remove: { issues: [ID] } }));
  });
  expect(screen.getByText(issueText.deletedNotice)).toBeTruthy();
  expect(region()).toBeNull();
});

test('expansion survives switching to the tree and back', async () => {
  view(chain());
  await graphShown();
  expect(node(tid(4))).toBeNull();
  await userEvent.click(
    within(node(tid(3)) as HTMLElement).getByRole('button', { name: m.expand(tid(3), 1) }),
  );
  await act(async () => flushFrames());
  expect(node(tid(4))).not.toBeNull();

  await userEvent.click(screen.getByRole('button', { name: m.viewTree }));
  await userEvent.click(screen.getByRole('button', { name: m.showTree(tid(3)) }));
  expect(screen.getByRole('list', { name: m.prerequisitesOf(tid(3)) })).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: m.viewGraph }));
  await graphShown();
  expect(node(tid(4))).not.toBeNull();

  await userEvent.click(screen.getByRole('button', { name: m.viewTree }));
  expect(screen.getByRole('list', { name: m.prerequisitesOf(tid(3)) })).toBeTruthy();
});

/** Bedienelemente und Knoten des Abschnitts, unabhängig von generierten IDs. */
function outline(): string[] {
  const section = region() as HTMLElement;
  const controls = (['button', 'checkbox', 'link'] as const).flatMap((role) =>
    within(section)
      .queryAllByRole(role)
      .map((el) => `${role}:${el.getAttribute('aria-label') ?? el.textContent}`),
  );
  const nodes = [...section.querySelectorAll('[data-dep-node]')].map(
    (el) => `node:${el.getAttribute('data-dep-node')}`,
  );
  return [...controls, ...nodes];
}

test('the section looks the same without write access', async () => {
  view(chain(), {}, ID, false);
  await graphShown();
  const readOnly = outline();
  expect(readOnly.length).toBeGreaterThan(5);

  cleanup();
  view(chain(), {}, ID, true);
  await graphShown();
  expect(outline()).toEqual(readOnly);
});
