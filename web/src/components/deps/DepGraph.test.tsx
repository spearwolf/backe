import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { depGraph, type DepGraph as Graph } from '../../app/dep-graph.ts';
import { Router, RouterContext } from '../../app/router.ts';
import { Store } from '../../data/store.ts';
import { testIssue, testState, tid } from '../../test/state.ts';
import { installXyflowStubs } from '../../test/xyflow.ts';
import { m } from '../../views/deps.messages.ts';
import { DepGraph } from './DepGraph.tsx';
import { HANDLE_STYLE } from './DepNode.tsx';
import { layoutDeps } from './dep-layout.ts';

vi.mock('./dep-layout.ts', async (original) => {
  const mod = await original<typeof import('./dep-layout.ts')>();
  return { ...mod, layoutDeps: vi.fn(mod.layoutDeps) };
});

type Issue = ReturnType<typeof testIssue>;

let uninstall: () => void;
let router: Router;

beforeEach(() => {
  uninstall = installXyflowStubs();
  window.history.replaceState(null, '', '/b/acme/issue/bk-t0003');
  router = new Router(window);
  vi.mocked(layoutDeps).mockClear();
});

afterEach(() => {
  cleanup();
  router.dispose();
  uninstall();
  document.documentElement.removeAttribute('data-theme');
});

function graphOf(issues: Issue[], id: string, opts: { expanded?: string[]; limit?: number } = {}) {
  const store = new Store();
  store.load(testState(issues));
  const s = store.toSnapshot();
  store.dispose();
  if (s === undefined) throw new Error('no snapshot');
  return depGraph(s, id, {
    parents: false,
    expanded: new Set(opts.expanded ?? []),
    limit: opts.limit,
  });
}

// u2 → u1 → c → d1 → d2 → d3; b blockiert c.
const [U2, U1, C, D1, D2, D3, B] = [1, 2, 3, 4, 5, 6, 7].map(tid) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const chain = (extra: Partial<Record<number, Partial<Issue>>> = {}): Issue[] => [
  testIssue(1, { state: 'done', ...extra[1] }),
  testIssue(2, { depends_on: [U2], ...extra[2] }),
  testIssue(3, { depends_on: [U1], blocked_by: [B], state: 'blocked', ...extra[3] }),
  testIssue(4, { depends_on: [C], ...extra[4] }),
  testIssue(5, { depends_on: [D1], ...extra[5] }),
  testIssue(6, { depends_on: [D2], ...extra[6] }),
  testIssue(7, { state: 'done', ...extra[7] }),
];

async function show(graph: Graph, onToggle: (id: string) => void = () => {}) {
  const props = { graph, backlog: 'acme', onToggle };
  const view = render(
    <RouterContext.Provider value={router}>
      <DepGraph {...props} />
    </RouterContext.Provider>,
  );
  // xyflow vermisst Knoten und passt die Ansicht in Folge-Updates ein.
  await act(async () => {});
  const rerender = async (next: Graph) => {
    view.rerender(
      <RouterContext.Provider value={router}>
        <DepGraph {...props} graph={next} />
      </RouterContext.Provider>,
    );
    await act(async () => {});
  };
  return { ...view, rerender };
}

const nodeEl = (container: HTMLElement, id: string) => {
  const el = container.querySelector(`[data-dep-node="${id}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no node ${id}`);
  return el;
};
/** `transform` des xyflow-Wrappers eines Knotens: seine Position auf der Fläche. */
const placed = (container: HTMLElement, id: string) =>
  (container.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null)?.style
    .transform;
const viewport = (container: HTMLElement) =>
  (container.querySelector('.react-flow__viewport') as HTMLElement | null)?.style.transform;
const edgePath = (container: HTMLElement, id: string) => {
  const el = container.querySelector(`[data-id="${id}"] path.react-flow__edge-path`);
  if (!(el instanceof SVGElement)) throw new Error(`no edge ${id}`);
  return el;
};

test('nodes show id, title and state, the centre is marked and no link', async () => {
  const { container } = await show(graphOf(chain(), C));
  const centre = nodeEl(container, C);
  expect(centre.getAttribute('aria-current')).toBe('true');
  expect(centre.getAttribute('data-role')).toBe('center');
  expect(centre.querySelector('a')).toBeNull();
  expect(within(centre).getByText(m.current)).toBeTruthy();
  expect(within(centre).getByText(C)).toBeTruthy();
  expect(within(centre).getByText('blocked')).toBeTruthy();
  // Hervorhebung in Vordergrundfarbe; `ring-ring` ist dem Fokus vorbehalten.
  expect(centre.className).toContain('bg-accent');
  expect(centre.className).toContain('ring-2');
  expect(centre.className).toContain('ring-foreground');
  expect(centre.className).not.toContain('ring-ring');

  const u1 = nodeEl(container, U1);
  expect(u1.getAttribute('data-role')).toBe('up');
  const link = within(u1).getByRole('link');
  expect(link.getAttribute('href')).toBe(`/b/acme/issue/${U1}`);
  expect(within(u1).getByText(U1)).toBeTruthy();
  expect(within(u1).getByText('todo')).toBeTruthy();
  const title = within(u1).getByText('Issue 2');
  expect(title.getAttribute('title')).toBe('Issue 2');
  expect(title.className).toContain('truncate');

  expect(screen.getByRole('application', { name: m.graphLabel(C) })).toBeTruthy();
});

test('a click on a node opens its issue tab', async () => {
  const { container } = await show(graphOf(chain(), C));
  // Ohne user-event: Der Link lässt d3-zoom das `mousedown` sehen (siehe `test/xyflow.ts`).
  fireEvent.click(within(nodeEl(container, D1)).getByRole('link'));
  expect(window.location.pathname).toBe(`/b/acme/issue/${D1}`);
  expect(router.location.value.pathname).toBe(`/b/acme/issue/${D1}`);
});

test('settled nodes are dimmed, open prerequisites strongly bordered', async () => {
  const { container } = await show(graphOf(chain(), C));
  // Erledigt: gestrichelt, Titel gedämpft, keine Deckkraft (Kontrast).
  const u2 = nodeEl(container, U2);
  expect(u2.className).toContain('border-dashed');
  expect(u2.className).not.toContain('opacity');
  expect(u2.className).not.toContain('border-2');
  expect(within(u2).getByText('Issue 1').className).toContain('text-muted-foreground');
  // b ist erledigt: Voraussetzung, aber nicht offen.
  expect(nodeEl(container, B).className).not.toContain('border-2');

  const u1 = nodeEl(container, U1);
  expect(u1.className).not.toContain('border-dashed');
  expect(within(u1).getByText('Issue 2').className).not.toContain('text-muted-foreground');
  expect(u1.className).toContain('border-2');
  expect(u1.className).toContain('border-foreground');
  const hint = within(u1).getByText(m.openPrerequisite);
  expect(hint.className).toContain('sr-only');
  // Abhängige sind nie »offene Voraussetzung«.
  expect(within(nodeEl(container, D1)).queryByText(m.openPrerequisite)).toBeNull();
});

test('edges carry their kind as dash pattern', async () => {
  const { container } = await show(graphOf(chain(), C));
  const blocked = edgePath(container, `${B}>${C}:blocked_by`);
  expect(blocked.style.strokeDasharray).toBe('6 4');
  expect(blocked.style.stroke).toBe('var(--muted-foreground)');
  expect(blocked.getAttribute('marker-end')).toMatch(/^url\(/);
  const depends = edgePath(container, `${U1}>${C}:depends_on`);
  expect(depends.style.strokeDasharray).toBe('');
  expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(5);

  // Beschriftung aus dem Katalog statt »Edge from … to …«, ohne englische Rollenbeschreibung.
  const group = container.querySelector(`[data-id="${B}>${C}:blocked_by"]`);
  expect(group?.getAttribute('aria-label')).toBe(m.edge(B, 'blocked_by', C));
  expect(container.querySelectorAll('.react-flow__edge[aria-roledescription]')).toHaveLength(0);

  const legend = screen.getByRole('list', { name: m.legend });
  expect(within(legend).getByText('depends_on')).toBeTruthy();
  expect(within(legend).getByText('blocked_by')).toBeTruthy();
  expect(within(legend).queryByText('parent')).toBeNull();
});

test('the legend names parent when the graph has a parent edge', async () => {
  const graph: Graph = {
    ...graphOf(chain(), C),
    edges: [{ from: D1, to: C, kind: 'parent' }],
  };
  await show(graph);
  const legend = screen.getByRole('list', { name: m.legend });
  expect(within(legend).getByText('parent')).toBeTruthy();
});

test('expand and collapse call onToggle', async () => {
  const onToggle = vi.fn();
  const { container, rerender } = await show(graphOf(chain(), C), onToggle);
  // Nur d2 hat verborgene Nachbarn (d3); die Mitte klappt nie auf.
  expect(within(nodeEl(container, C)).queryAllByRole('button')).toHaveLength(0);
  expect(within(nodeEl(container, D1)).queryAllByRole('button')).toHaveLength(0);
  const expand = within(nodeEl(container, D2)).getByRole('button', { name: m.expand(D2, 1) });
  expect(expand.textContent).toBe('+1');
  await userEvent.click(expand);
  expect(onToggle).toHaveBeenCalledExactlyOnceWith(D2);

  await rerender(graphOf(chain(), C, { expanded: [D2] }));
  const d2 = nodeEl(container, D2);
  expect(within(d2).queryByRole('button', { name: m.expand(D2, 1) })).toBeNull();
  await userEvent.click(within(d2).getByRole('button', { name: m.collapse(D2) }));
  expect(onToggle).toHaveBeenLastCalledWith(D2);
  expect(onToggle).toHaveBeenCalledTimes(2);
  expect(nodeEl(container, D3)).toBeTruthy();
});

test('a missing node is no link', async () => {
  const gone = tid(99);
  const { container } = await show(graphOf(chain({ 3: { depends_on: [U1, gone] } }), C));
  const node = nodeEl(container, gone);
  expect(within(node).getByText(m.missing)).toBeTruthy();
  expect(within(node).getByText(gone)).toBeTruthy();
  expect(node.querySelector('a')).toBeNull();
  expect(within(node).queryAllByRole('button')).toHaveLength(0);
  // Fehlend als Voraussetzung zählt als offen.
  expect(within(node).getByText(m.openPrerequisite)).toBeTruthy();
});

test('the collector shows the rest and no node expands', async () => {
  // c ← d1 ← e, dazu 251 weitere Abhängige von c; Limit 3: c, d1 und einer davon.
  const many = Array.from({ length: 251 }, (_, i) => testIssue(100 + i, { depends_on: [tid(1)] }));
  const issues = [
    testIssue(1),
    testIssue(2, { depends_on: [tid(1)] }),
    testIssue(3, { depends_on: [tid(2)] }),
    ...many,
  ];
  const graph = graphOf(issues, tid(1), { limit: 3 });
  expect(graph.more).toBe(251);
  expect(graph.nodes.some((n) => n.hidden > 0)).toBe(true);
  const { container } = await show(graph);
  const more = nodeEl(container, 'more');
  expect(more.textContent).toBe(m.more(251));
  expect(more.querySelector('a')).toBeNull();
  expect(container.querySelectorAll('[data-dep-node] button')).toHaveLength(0);
});

test('a field change keeps positions, a new edge lays out again', async () => {
  const { container, rerender } = await show(graphOf(chain(), C));
  expect(layoutDeps).toHaveBeenCalledTimes(1);
  const ids = [U2, U1, B, C, D1, D2];
  const before = ids.map((id) => placed(container, id));
  expect(before.every((t) => t?.startsWith('translate('))).toBe(true);
  expect(new Set(before).size).toBe(ids.length);

  await rerender(graphOf(chain({ 4: { title: 'Renamed', state: 'done' } }), C));
  expect(layoutDeps).toHaveBeenCalledTimes(1);
  expect(ids.map((id) => placed(container, id))).toEqual(before);
  const d1 = nodeEl(container, D1);
  expect(within(d1).getByText('Renamed')).toBeTruthy();
  expect(d1.className).toContain('border-dashed');

  await rerender(graphOf(chain({ 4: { depends_on: [C, B] } }), C));
  expect(layoutDeps).toHaveBeenCalledTimes(2);
  expect(container.querySelector(`[data-id="${B}>${D1}:depends_on"]`)).not.toBeNull();
});

test('a new structure fits the view again, a field change leaves it', async () => {
  const { container, rerender } = await show(graphOf(chain(), C));
  const first = viewport(container);
  // Eingepasst: fünf Ebenen sind höher als die Fläche (384 px), der Zoom liegt unter 1 und
  // über `minZoom`.
  const zoom = Number(/scale\(([\d.]+)\)/.exec(first ?? '')?.[1]);
  expect(zoom).toBeLessThan(1);
  expect(zoom).toBeGreaterThan(0.25);

  await rerender(graphOf(chain({ 4: { title: 'Renamed' } }), C));
  expect(viewport(container)).toBe(first);

  // d2 aufgeklappt: d3 kommt dazu, die Fläche wird höher, die Ansicht passt sich ein.
  await rerender(graphOf(chain(), C, { expanded: [D2] }));
  expect(viewport(container)).not.toBe(first);
});

test('xyflow adds no English descriptions to nodes', async () => {
  const { container } = await show(graphOf(chain(), C, { limit: 3 }));
  const wrappers = container.querySelectorAll('.react-flow__node');
  expect(wrappers.length).toBe(4); // 3 Knoten + Sammelknoten
  for (const el of wrappers) {
    expect(el.hasAttribute('aria-roledescription')).toBe(false);
    expect(el.hasAttribute('aria-describedby')).toBe(false);
  }
  expect(container.querySelector('[aria-live]')).toBeNull();
});

test('dom handles sit where the fixed handles say: no size, no shift', async () => {
  const { container } = await show(graphOf(chain(), C));
  const handles = nodeEl(container, C).querySelectorAll<HTMLElement>('.react-flow__handle');
  expect(handles).toHaveLength(2);
  for (const h of handles) {
    expect(h.style.width).toBe('0px');
    expect(h.style.height).toBe('0px');
    expect(h.style.transform).toBe('none');
    expect(h.style.visibility).toBe('hidden');
  }
  expect(HANDLE_STYLE.border).toBe(0);
});

test('the graph follows the dark theme', async () => {
  document.documentElement.setAttribute('data-theme', 'dark');
  const { container } = await show(graphOf(chain(), C));
  const flow = container.querySelector('.react-flow');
  expect(flow?.classList.contains('dark')).toBe(true);
  act(() => document.documentElement.setAttribute('data-theme', 'light'));
  await act(async () => {});
  expect(flow?.classList.contains('dark')).toBe(false);
  expect(flow?.classList.contains('light')).toBe(true);
});

test('controls are labelled from the catalogue and offer no interactivity toggle', async () => {
  await show(graphOf(chain(), C));
  expect(screen.getByRole('button', { name: m.zoomIn })).toBeTruthy();
  expect(screen.getByRole('button', { name: m.zoomOut })).toBeTruthy();
  expect(screen.getByRole('button', { name: m.fitView })).toBeTruthy();
  expect(screen.getByLabelText(m.controls)).toBeTruthy();
  expect(screen.getAllByRole('button')).toHaveLength(4); // 3 Controls + Aufklappen von d2
});
