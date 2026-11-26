# backe ui U5 — Tab Backlog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Tab Backlog zeigt die Issues eines Backlogs als virtualisierte, live aktualisierte Liste mit Filterleiste nach der Semantik von `issue list`, Baum- oder Flachansicht und Sortierung `rank`/`created` — ohne Schreibaktionen.

**Architecture:** Wie U4 in drei Schichten. `web/src/app/list-filter.ts` ist das reine Filter-Modell (`ListFilter` ↔ URL-Query ↔ `IssueSelector`), `web/src/app/backlog-list.ts` das reaktive Listen-Modell über dem Store (Memo `selectIssues(toSnapshot())`, Body-Treffer über `/search`, Live-Marken und ausblendende Zeilen), `web/src/views/` und `web/src/components/` sind reine Darstellung. Gefiltert und sortiert wird ausschließlich mit `selectIssues` aus `src/ops/issue-query.ts`; der Client erfindet keine eigene Filterlogik.

**Tech Stack:** wie U4. Neu als `devDependency`: `@tanstack/react-virtual` (aktuelles Release, Caret; Version beim Installieren in die Commit-Message). shadcn-Komponente `input` per `pnpm dlx shadcn@4.23.1 add input`.

**Spec:** `docs/proposals/ui.md` §2.5 »Ansichtszustand«, §2.7 ohne »Aktionen« außer »Klick öffnet den Issue-Tab«, §2.3.1 (`/search`), §2.17 (Liste: erste Darstellung ≤ 1,5 s, Scrollen ohne Frame-Drops), §5 »Client« (Filter-Parität). BK `docs/proposals/backe.md` §2.18 (`issue list`). Gesamtplan `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (Festlegungen »Text-Filter im Tab Backlog«, »Snapshot im Client«). ui.md ist `in Umsetzung`.

## Global Constraints

Alle Global Constraints des Gesamtplans und der Pläne U1–U4. Dazu für U5:

- Filter und Ordnung nur über `selectIssues` (`@backe/ops/issue-query.ts`) auf `store.toSnapshot()`; Fortschritt über `childProgress` (Task 1). Keine zweite Implementierung von State-, Projekt-, Property- oder Bereitschaftslogik im Client.
- Die Liste entspricht `issue list --all`: Kontextwerte (aktives Projekt, Sprint, Repo) filtern nie ungefragt mit (Präzisierung in ui.md §2.7, Task 1).
- Filter stehen in der URL-Query, Darstellung (Baum/flach) und Sortierung je Backlog unter `backe-ui:<backlog>:backlog-view` im `localStorage` (nur über `web/src/lib/storage.ts`). Default: alle Filter leer (= State »offen«), `{tree: true, sort: 'rank'}`.
- Zeitkonstanten: Live-Hervorhebung `HIGHLIGHT_MS = 1500` (ui.md §2.7), Ausblenden `FADE_MS = 300`, Such-Debounce `SEARCH_DEBOUNCE_MS = 200`. In Tests nur Fake Timers.
- Feste Zeilenhöhe `ROW_HEIGHT = 36` (px) für den Virtualizer; gerendert werden sichtbare Zeilen plus `overscan: 10`.
- Zustände per `lucide-react`-Icon **und** Text; Live-Marken über Hintergrund und `data-live`-Attribut, nicht nur über Farbe.
- Neue Texte en + de in `web/src/views/backlog.messages.ts`. State-Namen, IDs, Handles und Pfade bleiben roh wie im CLI.

## Review Focus

1. **Kaputte oder fremde URL** — `?state=bogus&prop=prio>>x&mode=fast&assignee=me` bei Identität `null`. Erwartet: keine Exception, je Feld eine Fehlermeldung in der Filterleiste, die übrigen Filter wirken. → Task 2 `bad url values become field errors`.
2. **Antworten von `/search` in falscher Reihenfolge oder gar nicht** — Tippen von `ab` → `abc`, die Antwort für `ab` kommt nach der für `abc`; oder 401/offline. Erwartet: nur die Treffer zum aktuellen Text zählen; bei Fehler bleiben Titeltreffer stehen, Hinweis »nur Titel«. → Task 4 `stale search answers are ignored`, `a failed search keeps title matches`.
3. **Patch schiebt eine Zeile aus dem Filter** — `issue move X done` bei Default-Filter »offen«. Erwartet: die Zeile blendet 300 ms aus statt zu springen, danach weg; ein Filterwechsel dagegen blendet nichts aus. → Task 5 `a row leaving through a patch fades`, `a filter change never fades`.
4. **Gefilterter Parent im Baum** — Kind passt, Parent nicht. Erwartet: Kind als Wurzel mit `depth: 0`, wie `issue list --tree`. → Task 3 Paritätsfall `tree with filtered parent`.
5. **Großes Backlog** — 5 000 Issues. Erwartet: weniger als 60 Zeilen im DOM, Patch auf ein Issue rendert nicht alle Zeilen neu. → Task 6 `renders only visible rows`, `a patch re-renders only its row`.

---

### Task 1: Vorlauf in BK — Fortschritt, Body-Treffer, Suche ohne Kontext

**Files:**
- Modify: `src/core/state.ts` (`ALL_STATES` exportieren)
- Modify: `src/ops/graph.ts` (`childProgress`)
- Modify: `src/services/issue-show.ts:125` (nutzt `childProgress`)
- Modify: `src/ops/issue-query.ts` (`bodyHits` im Selektor)
- Modify: `src/ui/read-api.ts:66` (`all: true`)
- Modify: `docs/proposals/ui.md` §2.3.1 Zeile `/search`, §2.7
- Test: `src/ops/graph.test.ts`, `src/ops/issue-query.test.ts`, `src/ui/read-api.test.ts`

**Interfaces:**
- Produces: `ALL_STATES: readonly State[]`; `childProgress(s: BacklogSnapshot, id: string): { settled: number; total: number } | undefined` (`undefined` ohne Kinder); `IssueSelector.bodyHits?: ReadonlySet<string>` — IDs, deren Beschreibung den Text enthält; ist es gesetzt, ersetzt es die Suche im `body` des Snapshots (Titel wird weiter durchsucht).

- [ ] **Step 1: Failing tests**

```ts
// src/ops/graph.test.ts
test('childProgress counts settled direct children', () => {
  // Parent P mit Kindern: done, cancelled, todo, in_progress, rejected; Enkel zählen nicht
  expect(childProgress(s, P)).toEqual({ settled: 3, total: 5 });
  expect(childProgress(s, LEAF)).toBeUndefined();
});
// src/ops/issue-query.test.ts
test('bodyHits replace the body search, the title still matches', () => {
  // A: Titel »Zebra«, B: Body »zebra«, C: weder noch; Snapshot-Bodies leer
  const ids = (q) => selectIssues(s, q).map((r) => r.issue.id);
  expect(ids({ filter: {}, states: 'all', text: 'zebra', bodyHits: new Set([C]) })).toEqual([A, C]);
});
// src/ui/read-api.test.ts
test('search ignores the project bound in the start directory', async () => {
  // Start-cwd mit Kontextbindung project=web; Treffer im Body eines Issues ohne Projekt
  expect(ids(await ui.get('/api/b/acme/search?q=Zebrastreifen'))).toContain(outside);
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm vitest run src/ops/graph.test.ts src/ops/issue-query.test.ts src/ui/read-api.test.ts`

- [ ] **Step 3: Implement** — `childProgress` über `graphOf(s).children` und `isSettled`; `issue-show.ts` ersetzt seine Zählung durch den Aufruf (Golden-Files bleiben byte-gleich). In `selectIssues` prüft der Text-Zweig `bodyHits.has(id)` statt `body.includes`, wenn `bodyHits` gesetzt ist. `/search` ruft `listIssues(ctx, { text, states: ['all'], all: true })`.

- [ ] **Step 4: ui.md nachziehen** — §2.3.1 `/search`: »wie `issue list -q <text> --state all --all`«. §2.7 »Filter«: Satz anhängen »Kontextwerte (aktives Projekt, Sprint, Repo) filtern nicht mit; die Liste entspricht `issue list --all`. Text filtert sofort über Titel und vereinigt das mit den Treffern von `GET …/search` in Beschreibungen.«

- [ ] **Step 5: Run** `pnpm vitest run src/ops src/services/issue-show.test.ts src/ui test/mcp` → PASS; `mise run check` grün.

- [ ] **Step 6: Commit** — `feat: Fortschritt und Body-Treffer im reinen Listenkern, Suche der UI ohne Kontextfilter`

### Task 2: Filter-Modell `ListFilter` ↔ URL ↔ `IssueSelector`

**Files:**
- Create: `web/src/app/list-filter.ts`, `web/src/views/backlog.messages.ts`
- Test: `web/src/app/list-filter.test.ts`

**Interfaces:**
- Consumes: `IssueSelector`, `PropFilter`, `parsePropFilter`, `checkPropFilter`, `normalizeStateInput`, `ALL_STATES` (Task 1), `BackeError`.
- Produces:

```ts
export type ListMode = 'ready' | 'blocked' | 'unblockable';
export type ListFilter = {
  states: readonly string[];      // leer = offen; ['all'] = alle
  projects: readonly string[]; exact: boolean;
  sprints: readonly string[]; repos: readonly string[];
  assignee?: string;              // Handle, 'me' oder 'none'
  creator?: string;
  mode?: string;                  // roh aus der URL, geprüft in toSelector
  props: readonly string[];       // Ausdrücke wie `--prop`
  hasProps: readonly string[];
  text: string;
};
export type ListView = { tree: boolean; sort: 'rank' | 'created' };
export const EMPTY_FILTER: ListFilter;
export const DEFAULT_VIEW: ListView;          // { tree: true, sort: 'rank' }
export function parseListFilter(search: string): ListFilter;
export function listFilterSearch(f: ListFilter): string;   // '' oder '?…'
export type FilterError = { field: keyof ListFilter; value: string; message: string };
export function toSelector(
  f: ListFilter, view: ListView,
  env: { me: string | null; config: BacklogConfig },
): { selector: IssueSelector; errors: FilterError[] };
```

URL-Parameter heißen wie die Flags von `issue list`: `state`, `project`, `exact` (`1`), `sprint`, `repo`, `assignee`, `creator`, `mode`, `prop`, `has-prop`, `q`. Mehrfachwerte als wiederholter Parameter; beim Lesen werden Kommas wie im CLI zusätzlich geteilt (außer bei `prop`, dessen Werte Kommas enthalten). `listFilterSearch` schreibt in genau dieser Reihenfolge und lässt leere Felder weg.

- [ ] **Step 1: Failing tests**

```ts
test('empty filter has an empty query', () => expect(listFilterSearch(EMPTY_FILTER)).toBe(''));
test('query round-trips', () => fc.assert(fc.property(arbFilter, (f) =>
  expect(parseListFilter(listFilterSearch(f))).toEqual(f))));
test('commas split like the cli', () =>
  expect(parseListFilter('?state=todo,review&state=done').states).toEqual(['todo', 'review', 'done']));
test('selector of the empty filter is issue list --all', () =>
  expect(toSelector(EMPTY_FILTER, DEFAULT_VIEW, env).selector)
    .toEqual({ filter: {}, exact: false, tree: true, sort: 'rank', props: [] }));
test('me resolves to the identity', () =>
  expect(toSelector({ ...EMPTY_FILTER, assignee: 'me' }, DEFAULT_VIEW, { ...env, me: 'spw' })
    .selector.assignee).toBe('spw'));
test('all wins over other states', …states: ['all', 'todo'] → selector.states === 'all');
test('in-progress normalizes', …states: ['in-progress'] → ['in_progress']);
test('bad url values become field errors', () => {
  const { selector, errors } = toSelector(
    parseListFilter('?state=bogus&state=todo&prop=prio>>x&mode=fast&assignee=me&sprint=s1'),
    DEFAULT_VIEW, { ...env, me: null });
  expect(errors.map((e) => e.field).sort()).toEqual(['assignee', 'mode', 'props', 'states']);
  expect(selector).toMatchObject({ states: ['todo'], filter: { sprint: ['s1'] } });
  expect(selector.assignee).toBeUndefined();
});
test('range on an unordered key is a field error', …checkPropFilter wirft → errors[0].field === 'props');
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm vitest run --project web web/src/app/list-filter.test.ts`

- [ ] **Step 3: Implement** — `toSelector` fängt `BackeError` je Wert und legt `{field, value, message}` ab; der ungültige Wert fällt aus dem Selektor, gültige Nachbarn bleiben. Leere Listen erzeugen keinen Schlüssel im `filter`. `text` geht kleingeschrieben und getrimmt in den Selektor, leer gar nicht. Neue Texte in `backlog.messages.ts`: `meNeedsIdentity` (en »`me` needs an identity«, de »`me` braucht eine Identität«), `unknownMode(mode)`.

- [ ] **Step 4: Run** → PASS

- [ ] **Step 5: Commit** — `feat: Filtermodell des Tabs Backlog mit URL-Form und Selektor`

### Task 3: Paritätstest Client-Filter gegen `issue list`

**Files:**
- Create: `web/src/app/list-filter.parity.test.ts` (Kopfzeile `// @vitest-environment node`)

**Interfaces:**
- Consumes: `testBacklog`, `writeOp` (`test/helpers/`), `listIssues`, `issueListResultJson`, `stateJson`, `Store`, `parseListFilter`, `toSelector`, `selectIssues`.

Der Test baut einmal (`beforeAll`) ein echtes Backlog mit ≥ 12 Issues: Projekte `web`, `web/auth`, `api`; zwei Sprints; zwei Assignees und ein unassigned; Sub-Issues über zwei Ebenen; `depends_on` auf ein offenes und ein erledigtes Issue; States aus Hauptlinie, `blocked`, `on_hold`, `done`, `cancelled`; eine deklarierte geordnete Enum-Property `prio` und eine freie numerische `points`; ein Issue mit Wort nur im Body. Der Client-Pfad lädt `stateJson(ctx)` in einen `Store` und rechnet `selectIssues(store.toSnapshot(), {...selector, bodyHits})`, `bodyHits` aus `listIssues(ctx, {text, states: ['all'], all: true})`. Verglichen wird je Fall `[{id, depth, open_deps}]` aus `issueListResultJson(listIssues(ctx, {...q, all: true}))`.

- [ ] **Step 1: Test mit `test.each` über diese Fälle** (URL-Query ↔ `IssueListQuery`):

| Query | `listIssues` |
| --- | --- |
| `` | `{}` |
| `?state=all` | `{states:['all']}` |
| `?state=todo&state=blocked` | `{states:['todo','blocked']}` |
| `?project=web` / `?project=web&exact=1` | `{projects:['web']}` / `+exact:true` |
| `?sprint=s1&sprint=s2` | `{sprints:['s1','s2']}` |
| `?assignee=me` / `?assignee=none` / `?creator=…` | entsprechend |
| `?mode=ready` / `blocked` / `unblockable` | `{mode}` |
| `?prop=prio>=high` / `?prop=points<=3` / `?has-prop=points` | `{props:[…]}` / `{hasProps:[…]}` |
| `?q=zebra` (nur Body) / `?q=Login` (Titel) | `{text}` |
| `?state=all&project=api` mit Baum, Sortierung `created`, flach | `{…, tree, sort}` |
| tree with filtered parent: `?assignee=claude-1` mit Kind ohne passenden Parent | `{assignee, tree:true}` |

- [ ] **Step 2: Run** `pnpm vitest run --project web web/src/app/list-filter.parity.test.ts` → PASS. Scheitert ein Fall, ist das ein Bug in Task 2 oder ein Gegenentwurf zu BK §2.18 — nicht den Test anpassen, sondern melden.

- [ ] **Step 3: Commit** — `test: Filter des Tabs Backlog gleich issue list --all auf einem echten Backlog`

### Task 4: Listen-Modell mit Ansicht und Body-Treffern

**Files:**
- Create: `web/src/app/backlog-list.ts`, `web/src/data/search.ts`
- Test: `web/src/app/backlog-list.test.ts`, `web/src/data/search.test.ts`

**Interfaces:**
- Consumes: `Store`, `toSelector`, `ListFilter`, `ListView`, `childProgress`, `getJson`, `readJson`/`writeJson`.
- Produces:

```ts
// data/search.ts
export function searchIds(backlog: string, q: string, fetchFn?: Fetch): Promise<string[]>; // GET /api/b/<b>/search?q=
// app/backlog-list.ts
export type ListRow = {
  issue: IssueJson; depth: number; openDeps: boolean;
  progress?: { settled: number; total: number };
  live?: 'fresh' | 'leaving';     // gesetzt in Task 5
};
export type Timers = { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void };
export class ViewPrefs {                       // localStorage `backe-ui:<backlog>:backlog-view`
  constructor(backlog: string);
  readonly view: Signal<ListView>;
  set(next: ListView): void;
  dispose(): void;
}
export class BacklogListModel {
  constructor(store: Store, opts: {
    filter: SignalReader<ListFilter>; view: SignalReader<ListView>; me: string | null;
    search: (q: string) => Promise<string[]>; timers?: Timers;
  });
  readonly selected: SignalReader<readonly ListRow[]>;     // rein, ohne Live-Marken
  readonly errors: SignalReader<readonly FilterError[]>;
  readonly bodySearch: Signal<'idle' | 'pending' | 'failed'>;
  dispose(): void;
}
```

Body-Treffer: Ist `text` nicht leer, startet `SEARCH_DEBOUNCE_MS` nach der letzten Änderung von `text` oder `store.head` ein `search(text)`. Die Antwort zählt nur, wenn `text` noch derselbe ist; bis dahin filtert nur der Titel (`bodyHits` leer). Fehler → `bodySearch = 'failed'`, Titeltreffer bleiben.

- [ ] **Step 1: Failing tests** (Store mit `load(fixtureState)`, Fake Timers)

```ts
test('rows follow selectIssues on the store snapshot', …expect(ids(model.selected())).toEqual([…]));
test('rows carry sub-issue progress', …row(P).progress → { settled: 1, total: 2 });
test('body hits join after the debounce', async () => {
  // filter q=zebra; Titel-Treffer A sofort, nach 200 ms + Antwort [B] → [A, B]
});
test('stale search answers are ignored', …Antwort für »ab« nach der für »abc« ändert nichts);
test('a new head searches again', …applyPatch mit neuem head → zweiter search-Aufruf nach 200 ms);
test('a failed search keeps title matches', …bodySearch() === 'failed', Titel-Treffer bleiben);
test('view prefs survive a broken storage', …localStorage wirft → DEFAULT_VIEW, set() wirft nicht);
test('view prefs reject foreign json', …{tree:'x'} → DEFAULT_VIEW);
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement** — `selected` als `createMemo` über `toSnapshot`, Filter, Ansicht, `me` und das Signal der gültigen Body-Treffer; die Such-Steuerung als `createEffect` mit injizierten `timers`. Alle Signale hängen an `this`, `dispose` räumt Timer und Gruppe ab.

- [ ] **Step 4: Run** → PASS

- [ ] **Step 5: Commit** — `feat: Listenmodell des Tabs Backlog mit Ansicht im localStorage und Beschreibungstreffern`

### Task 5: Live-Marken und ausblendende Zeilen

**Files:**
- Modify: `web/src/data/store.ts` (`lastChange`)
- Modify: `web/src/app/backlog-list.ts` (`rows`, `mergeLeaving`)
- Test: `web/src/data/store.test.ts`, `web/src/app/backlog-list.test.ts`

**Interfaces:**
- Produces: `Store.lastChange: Signal<{ rev: number; issues: readonly string[] } | undefined>` — von `applyPatch` gesetzt, wenn der Patch Issues upsertet oder entfernt (beide Listen zusammen); `load` setzt es nie. `BacklogListModel.rows: Signal<readonly ListRow[]>` — `selected` plus `live`. `export function mergeLeaving(prev: readonly ListRow[], next: readonly ListRow[], leaving: ReadonlySet<string>): ListRow[]`.

Regeln: Ein in `lastChange.issues` genanntes Issue, das in `rows` steht, trägt `HIGHLIGHT_MS` lang `live: 'fresh'`. Verschwindet eine Zeile aus `selected`, während Filter, Ansicht und Body-Treffer dieselben Werte haben wie beim vorigen Lauf (die Änderung kam also aus einem Patch), bleibt sie `FADE_MS` lang als `live: 'leaving'` stehen. `mergeLeaving` setzt jede ausblendende Zeile direkt hinter die nächste vorangehende Zeile aus `prev`, die im Ergebnis steht, sonst an den Anfang; Tiefe bleibt die alte.

- [ ] **Step 1: Failing tests**

```ts
// store.test.ts
test('a patch names its changed issues, a load does not', …);
// backlog-list.test.ts
test('mergeLeaving keeps the old neighbour', () =>
  expect(ids(mergeLeaving(rows('A','B','C','D'), rows('A','D'), new Set(['B','C'])))).toEqual(['A','B','C','D']));
test('mergeLeaving puts a leading row first', …);
test('a changed row is fresh for 1.5 s', …advanceTimersByTime(1499) fresh, (1) → undefined);
test('a new row is fresh', …);
test('a row leaving through a patch fades', …issue.move → done: 'leaving', nach 300 ms weg);
test('a filter change never fades', …state=all → state=todo: kein 'leaving');
test('load after reset marks nothing', …);
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement** — `rows` setzt ein `createEffect` aus `selected`, `lastChange` und den Timer-Mengen; das Memo `selected` bleibt frei von Nebenwirkungen.

- [ ] **Step 4: Run** → PASS

- [ ] **Step 5: Commit** — `feat: Live-Hervorhebung und Ausblenden im Listenmodell`

### Task 6: Ansicht — Filterleiste, virtualisierte Liste, Zeile

**Files:**
- Create: `web/src/components/ui/input.tsx` (shadcn), `web/src/components/StateIcon.tsx`, `web/src/components/FilterBar.tsx`, `web/src/components/IssueList.tsx`, `web/src/components/IssueRow.tsx`
- Modify: `web/src/views/BacklogView.tsx`, `web/src/components/App.tsx` (`me` an `BacklogView`), `package.json`, `pnpm-lock.yaml`
- Test: `web/src/views/BacklogView.test.tsx`, `web/src/components/FilterBar.test.tsx`

**Interfaces:**
- Consumes: Tasks 2, 4, 5; `useRouter`, `routeHref`, `useStore`, `useSignal`, `DropdownMenu*`, `Badge`, `ALL_STATES`.
- Produces: `<StateIcon state={State} />` (Icon + sichtbarer State-Name; Board U8 nutzt es wieder); `<BacklogView backlog={string} me={string | null} />`.

Aufbau nach ui.md §2.7 und `backlog.png`:

- **FilterBar** — je Filter ein `DropdownMenu`: State (Checkboxen über `ALL_STATES`, dazu »offen« = leere Auswahl und »alle«), Projekt (Pfade sortiert, eingerückt nach Tiefe, Schalter »exakt«), Sprint, Repo (Checkboxen), Assignee (`me`, `none`, User; Einfachauswahl), Creator (User), Modus (Einfachauswahl). Properties: Eingabefeld für Ausdrücke wie `--prop` (Enter fügt einen Chip hinzu, `×` entfernt), `has-prop` ebenso mit Schalter. Text: `input` mit `type="search"`. Rechts Baum/flach und Sortierung (aus `ViewPrefs`), daneben die Trefferzahl. Jede Änderung schreibt `listFilterSearch` per `router.navigate(pathname + query, {replace: true})`. Ein `FilterError` erscheint am Feld mit `aria-invalid` und Text. `bodySearch === 'failed'` zeigt »Nur Titel durchsucht«.
- **IssueList** — `useVirtualizer({ count, getScrollElement, estimateSize: () => ROW_HEIGHT, overscan: 10, getItemKey: (i) => rows[i].issue.id })`; Container `role="list"` mit `aria-label`, Zeilen `role="listitem"` mit `aria-setsize`/`aria-posinset`. In jsdom gibt `initialRect: { width: 1024, height: 600 }` die Fläche vor. Leere Liste: »Keine Issues für diesen Filter«.
- **IssueRow** (`React.memo`, Props primitiv bzw. das Issue-Objekt): `<a href={routeHref(issue)}>`, Klick ohne Modifikator → `router.navigate`, mit Modifikator Browser-Default; Einrückung `depth × 1rem`; `StateIcon`, ID in Monospace, Titel (abgeschnitten), Assignee, Projekte und Sprints als `Badge variant="outline"`, `⧗` mit `title`/`aria-label` »offene Abhängigkeiten« bei `openDeps`, Fortschritt `settled/total`. `data-live={live}`; `fresh` → dezenter Hintergrund mit Transition, `leaving` → `opacity-0` über `FADE_MS`.

- [ ] **Step 1: Failing tests**

```tsx
test('lists open issues as a tree by default', …Zeilen in Baumordnung, Einrückung per style);
test('clicking a row opens the issue tab', …router.location.pathname === '/b/acme/issue/bk-…');
test('state filter writes the url', …user wählt »todo« → location.search === '?state=todo');
test('url filter shows field errors', …?mode=fast → Text unknownMode, aria-invalid);
test('flat and created survive a reload', …ViewPrefs → neues BacklogView liest flat/created);
test('renders only visible rows', …5000 Issues → < 60 listitem);
test('a patch re-renders only its row', …Render-Zähler im IssueRow-Test-Hook: nur eine Zeile rendert neu);
test('a live change marks the row', …applyPatch → data-live="fresh");
test('scroll position stays after a patch', …scrollTop = 720, Patch fügt oben ein Issue ein → scrollTop bleibt 720);
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Install** `pnpm add -D @tanstack/react-virtual` und `pnpm dlx shadcn@4.23.1 add input`; implementieren.

- [ ] **Step 4: Run** `pnpm vitest run --project web` → PASS; `mise run check` und `mise run smoke` grün; `pnpm build` hält das Chunk-Budget (`scripts/check-ui-build.ts`).

- [ ] **Step 5: Sichtprüfung** — `backe ui` gegen ein Test-Backlog im Browser (Playwright-MCP): Filter, Baum/flach, Live-Update nach `backe issue move` im Terminal, Theme hell/dunkel. Screenshot an den User.

- [ ] **Step 6: Docs** — ui.md Status-Satz: §2.7 ohne »Aktionen« außer Öffnen als gebaut; ROADMAP »Tab Backlog« abhaken.

- [ ] **Step 7: Commit** — `feat: Tab Backlog mit Filterleiste, Baum und virtualisierter Live-Liste`
