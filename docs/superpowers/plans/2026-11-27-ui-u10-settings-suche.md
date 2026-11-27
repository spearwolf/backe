# backe ui U10 — Settings und Suche Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Tab Settings verwaltet Repositories, Projekte, Sprints, Users & Agents, zeigt die Backlog-Config lesend samt Sync-Status und hält die Oberflächen-Einstellungen (Theme, Sprache, externe Bilder, Default-Gruppierung des Boards); das Suchfeld in der Tab-Leiste findet Issues, Projekte, Sprints, Repos und User auf dem Store, `⌘K`/Strg+K fokussiert es, »In Beschreibungen suchen« fragt `/search`.

**Architecture:** Drei Schichten wie U8/U9. Unten rein: `web/src/app/search.ts` (Index und Treffer), `web/src/app/settings-model.ts` (Projektbaum, Sprint-Gruppen, Verweise, Rechte nach dem Identitätsschutz), `web/src/app/ui-prefs.ts` (Oberflächen-Einstellungen im `localStorage`). Darüber Komponenten: `SearchBox` im Hauptchunk (Tab-Leiste), Settings als Lazy-Chunk (`views/SettingsView.tsx` samt `components/settings/**`) hinter `ChunkBoundary`. Der Server liefert dazu die Beschreibungen von Projekten, Sprints und Repos in `/state` und Patches; die Tool-Typen in `src/ui/api.ts` decken die Verwaltungs-Tools ab.

**Tech Stack:** wie U9. Keine neue Abhängigkeit.

**Spec:** `docs/proposals/ui.md` §2.10 (ohne »Browser-Benachrichtigungen«, die kommen mit U11), §2.11, dazu §2.3.1 (`/state`), §2.5 »Ansichtszustand«, §2.6 »Tastatur«, §2.9.2 (Beschreibungen von Projekten, Sprints, Repos), §2.13, §2.14, §2.16 »Code-Splitting«, §4.1 (freigegeben: Projekte, Sprints, Repos in Settings; `backlog.jsonc` nur lesend; Schalter für externe Bilder in Settings). BK `docs/proposals/backe.md` §2.5 (Kurzform), §2.9–§2.13 (Projekte, Sprints, Repos, Users, Identitätsschutz §2.13 Punkt 4), §2.16.4 (Konflikte). Gesamtplan `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (U10). ui.md ist `in Umsetzung`.

## Global Constraints

Alle Global Constraints des Gesamtplans und der Pläne U1–U9. Dazu für U10:

- Suche: höchstens 8 Treffer je Gruppe (`SEARCH_LIMIT = 8`), Gruppen in der Reihenfolge Issues, Projekte, Sprints, Repos, User, dann die Beschreibungs-Treffer; ein exakter ID-Treffer steht ganz oben. Kein Roundtrip außer »In Beschreibungen suchen« (`GET …/search`, lesend, auch ohne Schreibrecht).
- Kurzform-ID nach BK §2.5: ohne Groß-/Kleinschreibung, eindeutiger Anfang des Zufallsteils ab 3 Zeichen, mit oder ohne den Präfix des Backlogs; ein fremder Präfix passt nie.
- `⌘K` (Meta) und Strg+K fokussieren das Suchfeld, nicht bei offenem Dialog oder Menü; Esc schließt die Liste, ein zweites Esc leert das Feld.
- Settings-Writes nur über `Writes.run` mit den Tools aus ui.md §2.3.2; jede entfernende Aktion (Repo, Projekt, User entfernen, Key widerrufen) und `sprint_close` mit Bestätigungsdialog über `ConfirmDialog` nach dem Muster von `DeleteDialog`.
- Ohne Schreibrecht (`canWrite: false`) zeigt Settings keine Schreibaktion: kein Anlegen, Entfernen, Umbenennen, Schließen, Widerrufen, kein `repo_check`, kein `sync_now`, kein lokaler Repo-Pfad. Oberflächen-Einstellungen bleiben bedienbar (nur `localStorage`).
- Policy-Ausblendung (ui.md §2.10) nach BK §2.13 Punkt 4 aus `settingsRights`; Admin nach `isAdmin` aus `@backe/ops/admin.ts`.
- `localStorage`-Keys: `backe-ui-lang` (`'en' | 'de'`, fehlt = Server-Sprache), `backe-ui-external-images` (`'off'` blockt, sonst erlaubt), `backe-ui-board-group` (`BoardGroup`), `backe-ui:<backlog>:settings` (eingeklappte Abschnitte). Zugriff nur über `lib/storage.ts`.
- Neue Texte en + de in `web/src/views/search.messages.ts` und `web/src/views/settings.messages.ts`; Feld- und Tool-Namen, Slugs, Handles, Fingerprints, Config-Keys bleiben roh.
- Initialer Chunk ≤ 300 KB gzip (`scripts/check-ui-build.ts`): Settings (`views/SettingsView.tsx`, `components/settings/**`) nur im Lazy-Chunk; Suche im Hauptchunk.

## Review Focus

1. **Nur-lesen in Settings** — Handle ohne Key öffnet `/settings`. Erwartet: keine Schreibaktion in keinem Abschnitt, kein Tool-Aufruf; Theme, Sprache und Schalter funktionieren. → Task 9 `read-only hides settings writes`.
2. **Policy-Ausblendung** — ein Mitglied ohne Admin-Recht, ein Agent als Identität, ein Admin vor einem anderen Admin oder einem Operator von Agents. Erwartet: nur, was die Policy erlaubt, steht da (Mitglied: »Agent anlegen« mit sich als Operator, eigene Keys widerrufen; Agent: nichts anlegen; Admin: kein »Entfernen« an Admins, Operatoren oder sich selbst). → Task 8 `rights follow the identity protection`, `a member sees only agent creation`.
3. **Merkwürdige Suchtexte** — nur Leerzeichen, Regex-Zeichen (`(`, `*`, `\`), Umlaute und Akzente (`Über`/`uber`), 300 Zeichen, eine ID mit fremdem Präfix, eine Kurzform unter 3 Zeichen. Erwartet: keine Ausnahme, leer bzw. passende Treffer, keine ID-Treffer für fremde Präfixe oder zu kurze Formen. → Task 2 `odd queries never throw`, `ids follow the short form rules`.
4. **Sprachwechsel bei offener Sitzung** — Sprache in Settings umstellen, während ein Board und ein Graph schon gerendert waren. Erwartet: alle Texte in der neuen Sprache, dieselbe Event-Verbindung (kein zweites `EventSource`), der Fokus bleibt auf der Sprachwahl, `<html lang>` folgt. → Task 4 `switching the language re-renders every text and keeps the session`.
5. **Patch bei offenem Dialog** — ein Patch entfernt das Repo, dessen Entfernen-Dialog offen ist, oder fügt einen Sprint hinzu. Erwartet: Listen folgen live, der Dialog einer verschwundenen Entität schließt sich ohne Ausnahme. → Task 6 `lists follow patches and a dialog of a vanished repo closes`.

---

### Task 1: Server — Beschreibungen in `/state`, Tool-Typen, Admin-Regel in der Hülle

**Files:**
- Modify: `src/ui/delta.ts` (`entityLists`, `entityTable`), `src/ui/api.ts` (`ProjectJson`, `SprintJson`, `RepoJson`, `ToolArgs`, `ToolResults`), `src/ops/admin.ts` (Parameter `record` als `Pick<User, 'kind'> | undefined`), `test/helpers/web-closure.ts` (`'src/ops/admin.ts'` in `WEB_ENTRIES`)
- Test: `src/ui/delta.test.ts`, `src/ui/state.test.ts`, `src/ui/tool-args.test.ts` (läuft unverändert gegen die neuen Keys), `test/conventions.test.ts`

**Interfaces:**
- Produces:

```ts
// src/ui/api.ts
export type ProjectJson = { path: string; body?: string } & Project;
export type SprintJson = { slug: string; body?: string } & Sprint;
export type RepoJson = { name: string; body?: string } & Repo;
export type RepoFindingJson = { level: 'error' | 'warning' | 'info'; kind: 'local' | 'ref' | 'network' | 'github'; message: string };
export type RepoCheckJson = {
  repos: { name: string; url: string; canonical?: string; findings: RepoFindingJson[]; github?: { visibility: string; archived: boolean }; cached?: string }[];
  notices?: NoticeJson[];
};
export type SyncResultJson = { fetched: number; replayed: number; conflicts: number; pushed: number | null; rounds: number; skipped?: string; notices?: NoticeJson[] };
export type CreateAgentJson = { handle: string; key_path: string; commit: string | null };
// ToolArgs zusätzlich, Keys = Parameter des Katalogs (src/tools/admin.ts, src/tools/sync.ts):
//   project_create {path, title?, lead?, body?}; project_mv {from, to}; project_rm {path, reassign?, detach?}
//   sprint_create {slug, title?, start?, end?, body?}; sprint_close {slug, carry_over?}
//   repo_add {url, name?, ref?, body?}; repo_rm {name}; repo_check {names?, remote?, fresh?}
//   user_add {handle, key, name?, agent?, operator?}; user_create_agent {handle, name?}
//   user_revoke_key {handle, fingerprint}; user_rm {handle}; sync_now {}
// ToolResults: repo_check → RepoCheckJson, sync_now → SyncResultJson, user_create_agent → CreateAgentJson.
```

Typ von `skipped`, `conflicts` u. a. gegen `syncJson` in `src/services/views.ts` prüfen und exakt übernehmen. `body` steht in den Einträgen von `projects`, `sprints`, `repos` wie bei `sprint show --format json`: fehlt, wenn leer. Eine reine Body-Änderung eines Projekts, Sprints oder Repos ist damit ein `upsert` im Patch.

- [ ] **Step 1: Failing tests**

```ts
// src/ui/delta.test.ts
test('project, sprint and repo bodies travel in the entity lists', …Snapshot mit Projekt-Body 'Ziel', leerem Sprint-Body → projects[0].body == 'Ziel', 'body' in sprints[0] false);
test('a changed project body is an upsert', …zwei Snapshots, nur Body anders → patch.upsert.projects == [{path, title, body: 'neu'}]);
// src/ui/state.test.ts
test('state carries sprint goals', …Fixture-Backlog mit sprint create --body → state.sprints[0].body);
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm vitest run src/ui/delta.test.ts src/ui/state.test.ts`
- [ ] **Step 3: Implement**; `isAdmin` nimmt `Pick<User, 'kind'> | undefined`, `src/ops/admin.ts` in `WEB_ENTRIES`
- [ ] **Step 4: Run** `pnpm vitest run src/ui test/conventions.test.ts` und `pnpm run lint` → PASS
- [ ] **Step 5: Commit** — `feat: Beschreibungen von Projekten, Sprints und Repos im Zustand der UI`

### Task 2: Suche — reiner Index und Treffer

**Files:**
- Create: `web/src/app/search.ts`
- Test: `web/src/app/search.test.ts`

**Interfaces:**
- Consumes: `compareIssues` (`@backe/ops/order.ts`), `isSettled` (`@backe/core/state.ts`), `compareCodeUnits`, Entitäts-JSON aus `@backe/ui/api.ts`, `Store`.
- Produces:

```ts
export const SEARCH_LIMIT = 8;
export const SHORT_ID_MIN = 3;
/** NFKD, ohne Kombinationszeichen, klein. */
export function fold(s: string): string;
export type SearchIndex = { /* vorgefaltete Felder je Entität, intern */ };
export function buildSearchIndex(input: {
  issues: readonly IssueJson[]; projects: readonly ProjectJson[]; sprints: readonly SprintJson[];
  repos: readonly RepoJson[]; users: readonly UserJson[];
}): SearchIndex;
/** Memo je Store (WeakMap wie `store-options.ts`), neu bei jeder Entitätsänderung. */
export function searchIndexOf(store: Store): SignalReader<SearchIndex>;
export type SearchHit =
  | { kind: 'issue'; issue: IssueJson; exact: boolean }
  | { kind: 'project'; project: ProjectJson }
  | { kind: 'sprint'; sprint: SprintJson }
  | { kind: 'repo'; repo: RepoJson }
  | { kind: 'user'; user: UserJson };
export type SearchGroupKind = 'issue' | 'project' | 'sprint' | 'repo' | 'user';
export type SearchGroup = { kind: SearchGroupKind; hits: SearchHit[]; more: number };
/** Nur nicht leere Gruppen, in fester Reihenfolge; leere Anfrage → []. */
export function searchStore(index: SearchIndex, query: string, prefix: string | undefined): SearchGroup[];
```

Regeln:
- Wörter eines Feldes: `fold(feld).split(/[^\p{L}\p{N}]+/u)`; Anfrage-Tokens: `fold(q).split(/\s+/)` ohne leere.
- Score eines Tokens über die Felder einer Entität, der beste zählt: Wort gleich Token 4; Wort beginnt mit Token 3; gefaltetes Feld enthält Token 2; Token ab 4 Zeichen und ein Wort (oder dessen Anfang in Token-Länge) mit Damerau-Levenshtein-Abstand 1 → 1 (»unscharf«); sonst 0. Eine Entität trifft, wenn jedes Token > 0; Score = Summe.
- Felder: Issue `title`; Projekt `path`, `title`; Sprint `slug`, `title`; Repo `name`, `url`; User `handle`, `name`.
- Issue-ID: Anfrage ohne Leerraum, gefaltet. Gleich der ID → exakt. Mit Präfix `<p>-<rest>`: `p` ≠ `prefix` → kein ID-Treffer; sonst `rest` als Kurzform. Ohne Präfix die ganze Anfrage als Kurzform. Kurzform ab `SHORT_ID_MIN` Zeichen: Zufallsteil beginnt damit → Treffer mit Score 5; gleich dem Zufallsteil → exakt. Ein ID-Treffer und ein Titel-Treffer desselben Issues zählen einmal (höherer Score).
- Reihenfolge: exakt zuerst, dann Score absteigend; Issues danach offene vor erledigten (`isSettled`), dann `compareIssues`; andere nach Schlüssel (`compareCodeUnits`). Je Gruppe die ersten `SEARCH_LIMIT`, `more` = Rest.

- [ ] **Step 1: Failing tests**

```ts
test('title words match by prefix, substring and one typo', …'Login-Seite reparieren': 'log' trifft (3), 'seite rep' trifft, 'reparirn' (Abstand 1) trifft, 'xyz' nicht);
test('every token must match', …'login fehlt' trifft 'Login fehlt' aber nicht 'Login');
test('ids follow the short form rules', …bk-7f3k2: '7f3' trifft, 'BK-7F3' trifft, 'ac-7f3' nicht, '7f' nicht, 'bk-7f3k2' exakt, '7f3k2' exakt);
test('an exact id hit stands first', …Issue mit Titel '7f3k2 notes' und Issue bk-7f3k2 → hits[0] ist bk-7f3k2 mit exact true);
test('folding ignores case and accents', …'uber' trifft 'Über', 'CAFE' trifft 'café');
test('groups keep their order and stop at eight', …12 Projekte → group project hits 8, more 4; Reihenfolge issue, project, sprint, repo, user);
test('open issues come before settled ones at equal score', …);
test('projects, sprints, repos and users match their fields', …Pfad, Titel, Slug, URL-Teil 'github', Handle, Name);
test('odd queries never throw', …'   ' → []; '(*\\[' → [] ohne Ausnahme; 'a'.repeat(300) → []);
test('the index memo follows the store', …searchIndexOf(store) gleich bei zweitem Aufruf; Patch mit neuem Issue → searchStore findet es);
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm vitest run --project web web/src/app/search`
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** — `feat: Suche auf dem Store mit Kurzform-IDs und unscharfen Titelwörtern`

### Task 3: Suchfeld in der Tab-Leiste mit `⌘K`

**Files:**
- Create: `web/src/views/search.messages.ts`, `web/src/components/SearchBox.tsx`
- Modify: `web/src/components/TabBar.tsx` (SearchBox zwischen Tab-Liste und `⚙`)
- Test: `web/src/components/SearchBox.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`searchIndexOf`, `searchStore`, `SearchGroup`), `searchIds` (`data/search.ts`), `routeHref`, `useRouter`, `listFilterSearch`, `EMPTY_FILTER`, `StateIcon`, `useStore`, `useSignal`.
- Produces: `export function SearchBox({ backlog }: { backlog: string }): JSX.Element;`

```ts
// search.messages.ts — en + de, mindestens:
// label ('Search' / 'Suche'), placeholder ('Search…' / 'Suchen …'), shortcut(mac: boolean) ('⌘K' / 'Ctrl K' bzw. 'Strg K'),
// groups: issues, projects, sprints, repos, users, bodies ('In descriptions' / 'In Beschreibungen'),
// searchBodies ('Search in descriptions' / 'In Beschreibungen suchen'), searching, bodyFailed, noBodyHits,
// more(n) ('+n more' / '+n weitere'), exact ('exact match' / 'exakter Treffer'), closed ('closed' / 'geschlossen'), agent
```

Verhalten (WAI-ARIA Combobox mit Listbox):
- `<input role="combobox" aria-expanded aria-controls aria-activedescendant aria-autocomplete="list" aria-keyshortcuts="Meta+K Control+K">`, darunter bei nicht leerer Anfrage eine `role="listbox"` mit `role="group"` je Gruppe (`aria-labelledby` auf die Gruppenüberschrift), Optionen `role="option"` mit `aria-selected`. Gruppe ohne Treffer fehlt; `more > 0` → nicht wählbare Zeile `more(n)`.
- Letzte Option immer »In Beschreibungen suchen«; Auswahl ruft `searchIds(backlog, query)`, zeigt `searching`, dann die Treffer (nur IDs im Store, höchstens 8, `more`) als Gruppe `bodies` an ihrer Stelle; Fehler → `bodyFailed` samt `message`; keine Treffer → `noBodyHits`. Eine neue Eingabe verwirft das Ergebnis; eine Antwort zu einer älteren Anfrage wird ignoriert.
- Tasten: ↓/↑ wandern zyklisch über die wählbaren Optionen, die erste ist aktiv; Enter wählt; Esc schließt die Liste, bei geschlossener Liste leert es das Feld. Klick wählt. Fokus verlässt den Bereich → Liste zu.
- Auswahl: Issue → `routeHref({kind:'issue'})`; Projekt → Backlog mit `listFilterSearch({...EMPTY_FILTER, projects: [path]})`; Sprint `sprints`, Repo `repos`, User `assignee: handle`. Danach Feld leer, Liste zu, Fokus bleibt im Feld.
- `⌘K`/Strg+K (`e.key.toLowerCase() === 'k'`, genau einer von Meta/Ctrl, ohne Alt/Shift) auf `document`: `preventDefault`, Feld fokussieren und Text markieren; nichts bei offenem `[role="dialog"], [role="alertdialog"], [role="menu"]`. Platzhalter zeigt `shortcut(isMac)` mit `isMac = /Mac|iPhone|iPad/.test(navigator.platform)`.
- Breite `w-40 sm:w-56`, Liste rechtsbündig, `w-[28rem] max-w-[calc(100vw-1rem)]`, `max-h-[70vh] overflow-auto`, Zeilen wie `IssueRef` (Icon, ID mono, Titel `truncate`).

- [ ] **Step 1: Failing tests** (Harness wie `TabBar` in `App.test.tsx`: Store mit Issues, Projekten, Sprints, Repos, Users; Router mit Fake-Window)

```tsx
test('typing shows grouped hits with the exact id first', …'bk-t0001' → erste Option Issue t0001, Gruppe issues);
test('arrow keys and enter open the issue tab', …↓ ↓ Enter → Router-Pfad /b/acme/issue/<id>, Feld leer, Liste zu);
test('a project opens the backlog filtered by it', …Projekt wählen → /b/acme/backlog?project=web);
test('sprint, repo and user hits filter the backlog', …?sprint=…, ?repo=…, ?assignee=…);
test('cmd-k and ctrl-k focus the field but not over a dialog', …Meta+K → Fokus; Ctrl+K → Fokus; mit [role=dialog] im DOM → kein Fokus);
test('escape closes first and clears second', …);
test('searching descriptions shows the server hits in the list', …fetch-Mock /api/b/acme/search?q=… → {issues:[{id}]} → Gruppe bodies mit dem Issue; neue Eingabe → Gruppe weg);
test('a late answer for an older query is dropped', …zwei Abfragen, erste antwortet zuletzt → zweite bleibt);
test('a failed description search shows the message', …500 mit error.message);
test('more than eight hits show the rest as a count', …12 Projekte → '+4 more');
test('search works without write access', …canWrite false → Treffer und Auswahl gehen);
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm vitest run --project web web/src/components/SearchBox`
- [ ] **Step 3: Implement**, in `TabBar` einhängen
- [ ] **Step 4: Run** `pnpm vitest run --project web` → PASS (TabBar-, App- und Read-only-Tests bleiben grün)
- [ ] **Step 5: Commit** — `feat: Suchfeld in der Tab-Leiste mit Cmd-K und Suche in Beschreibungen`

### Task 4: Oberflächen-Einstellungen — Sprache, externe Bilder, Default-Gruppierung

**Files:**
- Create: `web/src/app/ui-prefs.ts`, `web/src/app/ui-context.tsx`
- Modify: `web/src/app/bootstrap.tsx` (`UiPrefs` mit `list.lang` statt `setLocale` direkt), `web/src/components/App.tsx` (Prop `prefs`, `UiContext.Provider` mit `theme` und `prefs`, `<Fragment key={lang}>` um Kopfzeile und Inhalt), `web/src/markdown/Markdown.tsx` (Komponente `img`), `web/src/markdown/mermaid.messages.ts` oder eigene `markdown.messages.ts` (Text `imageBlocked`), `web/src/app/board-state.ts` (`BoardPrefs(backlog, defaultGroup)`), `web/src/views/BoardView.tsx` (Default aus `useUiPrefs()`)
- Test: `web/src/app/ui-prefs.test.ts`, `web/src/components/App-language.test.tsx`, `web/src/markdown/Markdown.test.tsx`, `web/src/app/board-state.test.ts`

**Interfaces:**
- Consumes: `setLocale`, `readText`/`writeText`, `BoardGroup`, `BOARD_GROUPS`, `Theme`.
- Produces:

```ts
// ui-prefs.ts
export type LangChoice = 'server' | 'en' | 'de';
export const LANG_KEY = 'backe-ui-lang';
export const EXTERNAL_IMAGES_KEY = 'backe-ui-external-images';
export const BOARD_GROUP_KEY = 'backe-ui-board-group';
export class UiPrefs {
  constructor(serverLang: Locale, root?: HTMLElement); // setzt Locale und <html lang> sofort
  readonly serverLang: Locale;
  readonly langChoice: Signal<LangChoice>;
  /** Wirksame Sprache: Wahl oder Server-Sprache. */
  readonly lang: SignalReader<Locale>;
  readonly externalImages: Signal<boolean>;
  readonly boardGroup: Signal<BoardGroup>;
  setLang(choice: LangChoice): void;   // speichert ('server' entfernt den Wert → writeText mit '' gilt als fehlend), setLocale, <html lang>, merkt Fokuswunsch
  setExternalImages(on: boolean): void;
  setBoardGroup(group: BoardGroup): void;
  /** Einmalig true nach `setLang`: Die neu gemountete Sprachwahl holt sich den Fokus. */
  takeLangFocus(): boolean;
  dispose(): void;
}
// ui-context.tsx
export type UiAccess = { theme: Theme; prefs: UiPrefs };
export const UiContext: React.Context<UiAccess | null>;
export function useUi(): UiAccess;              // wirft ohne Provider
export function useExternalImages(): boolean;   // ohne Provider true (Markdown in Tests und Dialogen)
```

Regeln:
- Sprachwechsel rendert alles neu: `App` liest `useSignal(prefs.lang)` und setzt `key={lang}` auf ein Fragment um `Header` und den Inhalt, nicht um `App` selbst; die Sitzung (`useOwned` in `App`) bleibt, Ansichten mounten neu (auch `React.memo`-Komponenten und der `ariaLabels`-Cache in `DepGraph`). Fehlertexte des Servers bleiben in Server-Sprache (ui.md §2.14).
- Externe Bilder: `img` im Markdown mit `src` auf `http:`/`https:` bei `externalImages === false` → statt `<img>` ein `<a href={src} target="_blank" rel="noopener noreferrer">` mit `ImageOff`-Icon und `imageBlocked(alt)` (»Externes Bild blockiert: <alt>«); Anhänge, `blob:` und `data:` bleiben.
- `BoardPrefs(backlog, defaultGroup = DEFAULT_BOARD_VIEW.group)`: Ohne gespeicherte Ansicht des Backlogs gilt `{ ...DEFAULT_BOARD_VIEW, group: defaultGroup }`; eine gespeicherte Wahl des Boards gilt weiter.
- Ungültige Werte im `localStorage` → Default (Server-Sprache, Bilder erlaubt, `sprint`).

- [ ] **Step 1: Failing tests**

```ts
// ui-prefs.test.ts
test('defaults follow the server and tolerate garbage', …localStorage 'fr' → langChoice 'server', lang = serverLang; Bilder-Key 'x' → true; Gruppe 'foo' → 'sprint');
test('a language choice persists, sets the locale and the html lang', …setLang('de') → locale() 'de', root.lang 'de', neu gebaut → 'de'; setLang('server') → serverLang, Key entfernt bzw. leer);
test('the focus request is taken once', …);
test('image and board settings persist', …);
// board-state.test.ts
test('the board starts with the default grouping unless it has its own', …new BoardPrefs('acme', 'project').view.value.group == 'project'; mit gespeicherter Ansicht → deren Gruppe);
// Markdown.test.tsx
test('external images stay blocked when switched off', …Provider mit externalImages false: kein <img>, Link mit Text imageBlocked; Anhang-Bild bleibt <img>);
// App-language.test.tsx — mountApp mit Fake-EventSource
test('switching the language re-renders every text and keeps the session', …Server 'en'; prefs.setLang('de') in act → Tab »Board«/Kopfzeile deutsch (z. B. m.settings 'Einstellungen'), fakeEventSources().length unverändert 1, document.documentElement.lang 'de');
```

- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** `pnpm vitest run --project web` → PASS
- [ ] **Step 5: Commit** — `feat: Sprache, externe Bilder und Default-Gruppierung als Einstellungen der Oberfläche`

### Task 5: Settings-Gerüst als Lazy-Chunk, Abschnitte Oberfläche und Backlog

**Files:**
- Create: `web/src/views/settings.messages.ts`, `web/src/app/settings-model.ts` (Abschnitte), `web/src/app/settings-prefs.ts`, `web/src/components/settings/SettingsSection.tsx`, `web/src/components/settings/fields.tsx`, `web/src/components/settings/InterfaceSection.tsx`, `web/src/components/settings/BacklogSection.tsx`
- Modify: `web/src/views/SettingsView.tsx` (Gerüst, Default-Export für `lazy`), `web/src/components/App.tsx` (`lazy` + `ChunkBoundary` + `Suspense` wie Board; `section` aus der Route), `web/src/components/write/ConfirmDialog.tsx` (Prop `formId`)
- Test: `web/src/app/settings-prefs.test.ts`, `web/src/views/SettingsView.test.tsx`, `web/src/components/settings/InterfaceSection.test.tsx`, `web/src/components/settings/BacklogSection.test.tsx`, `web/src/components/App-settings-error.test.tsx` (eigene Datei: `React.lazy` merkt sich das Modul), `web/src/components/write/ConfirmDialog.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`useUi`), `ChunkBoundary`, `useWrites`, `useStore`, `useSignal`, `ConfirmDialog`, `useAction`, `ActionError`, `formatBytes`, `formatDate`, `routeHref`, `useLinkClick`, `syncDisplay`.
- Produces:

```ts
// settings-model.ts
export const SETTINGS_SECTIONS = ['repositories', 'projects', 'sprints', 'users', 'backlog', 'interface'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export function isSettingsSection(s: string): s is SettingsSection;
// settings-prefs.ts — Key `backe-ui:<backlog>:settings`, Guard je Feld
export function readFolded(backlog: string): Partial<Record<SettingsSection, boolean>>;
export function writeFolded(backlog: string, folded: Partial<Record<SettingsSection, boolean>>): void;
// SettingsView.tsx
export default function SettingsView(props: { backlog: string; section: string | undefined }): JSX.Element;
// SettingsSection.tsx
export function SettingsSection(props: { id: SettingsSection; title: string; folded: boolean; onToggle: () => void; actions?: ReactNode; children: ReactNode }): JSX.Element;
// fields.tsx — beschriftetes Feld mit Hinweis/Fehler (aria-describedby, aria-invalid)
export function Field(props: { label: string; hint?: string; error?: string; children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode }): JSX.Element;
// ConfirmDialog: formId?: string → Bestätigen ist `type="submit" form={formId}`, der Aufrufer legt `<form id={formId} onSubmit>` um seine Felder
```

Regeln:
- Layout nach `settings.png`: Überschrift `settings`, ab `lg:` links eine `<nav aria-label={sectionsNav}>` mit Links auf `routeHref({kind:'settings', section})` (`aria-current` am gewählten), rechts die Abschnitte untereinander. Jeder Abschnitt `<section id="settings-<id>" aria-labelledby>`, Kopf mit Klappknopf (`aria-expanded`, Chevron, Titel als `h2`) und rechts `actions` (etwa »Hinzufügen«); eingeklappt ist nur der Kopf zu sehen. Default offen; Klappzustand je Backlog über `settings-prefs.ts`.
- Route `/settings/<section>`: Abschnitt aufklappen, per `scrollIntoView?.({block:'start'})` zeigen und seinen Klappknopf fokussieren (nur bei Wechsel der Route, nicht bei jedem Render). Unbekannter Abschnitt → Hinweis `unknownSection(name)` über den Abschnitten.
- Lazy: `const SettingsView = lazy(() => import('../views/SettingsView.tsx'))`, in `App` wie das Board in `ChunkBoundary` + `Suspense fallback={m.loading}`.
- **Oberfläche:** Theme als Radiogruppe (`fieldset`, `light`/`dark`/`system` mit den Texten aus `app.messages.ts`) über `theme.set`; Sprache als `<select>` (`server` mit `langServer(name)` — »Sprache des Servers (English)«, `en` »English«, `de` »Deutsch«, Sprachnamen unübersetzt) über `prefs.setLang`, holt nach dem Neumounten per `takeLangFocus()` in `useLayoutEffect` den Fokus; Checkbox `externalImages` mit Hinweis; `<select>` Default-Gruppierung mit den Gruppentexten aus `board.messages.ts` und Hinweis `boardGroupHint` (»Gilt für Boards ohne eigene Wahl.«). Browser-Benachrichtigungen fehlen (U11).
- **Backlog:** `config` als Beschreibungsliste (`<dl>`): Name, ID-Präfix, Admins, Workflow (`strict` ja/nein), Sync (`mode`, `remote`, `branch`, `pull_interval` s), `verify`, Anhänge (`max_bytes` über `formatBytes`, `null` = unbegrenzt; `lfs`), `props_strict`; deklarierte Properties als Tabelle (Key mono, Typ samt `values` bei `enum`, `description`). Hinweis `configReadOnly` (Bearbeiten nur per Hand-Edit und `backe commit`). Sync-Status aus `store.sync`: ohne eigene Arbeitskopie (`null`) `noWorkingCopy`; sonst Remote, Modus, `unpushed`, letzter Versuch/Erfolg (`formatDate`), letzter Fehler, `running`; Konflikte als Liste (`id` mono, `created`, `subject`, `reason`) mit Hinweis `backe sync resolve` im Code-Stil. Mit Schreibrecht Knopf `syncNow` → `writes.run('sync_now', {})` über `useAction`, danach `syncDone(result)` (geholt, eingespielt, gepusht) samt Notices; Fehler über `ActionError`.

- [ ] **Step 1: Failing tests**

```tsx
// settings-prefs.test.ts
test('folded sections survive and tolerate garbage', …);
// ConfirmDialog.test.tsx
test('with a form id enter in a field confirms', …<form id> mit Input, Enter → onConfirm einmal);
// SettingsView.test.tsx — Harness wie read-issue-view: Store, WriteContext, UiContext, Router
test('all sections show with a navigation', …sechs region-Rollen mit Titeln; nav mit sechs Links);
test('a section route unfolds, scrolls and focuses it', …folded projects gespeichert; Route /settings/projects → aria-expanded true, scrollIntoView gerufen, Fokus am Klappknopf);
test('folding is remembered per backlog', …);
test('an unknown section shows a notice', …);
// InterfaceSection.test.tsx
test('theme, language, images and board grouping write their settings', …Radio dark → data-theme dark; Sprache de → prefs.lang 'de'; Checkbox aus → prefs.externalImages false; Gruppe repo → BOARD_GROUP_KEY);
test('the language select keeps the focus after a switch', …);
// BacklogSection.test.tsx
test('the config shows read only with declared properties', …admins, id_prefix, max_bytes formatiert, Property mit enum-Werten und description);
test('sync status lists conflicts with the resolve hint', …store.sync mit conflicts → id, subject, Text backe sync resolve);
test('sync now calls the tool and shows the result', …writes-Harness: Knopf → call sync_now {}; Antwort {fetched:2,pushed:1,…} → syncDone-Text);
test('without a working copy there is no sync block', …sync null → noWorkingCopy, kein Knopf);
// App-settings-error.test.tsx
test('a settings chunk that fails to load shows a line, the tabs stay usable', …vi.mock('../views/SettingsView.tsx', () => { throw … }) wie App-board-error → chunkFailed, Tab Backlog bedienbar);
```

- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** `pnpm vitest run --project web` → PASS; `pnpm build` → Settings in eigenem Chunk unter `dist/ui/assets/`, nicht in `index-*.js`; Budget gehalten
- [ ] **Step 5: Commit** — `feat: Settings als eigener Chunk mit den Abschnitten Oberfläche und Backlog`

### Task 6: Abschnitt Repositories

**Files:**
- Create: `web/src/components/settings/ReposSection.tsx`
- Modify: `web/src/app/settings-model.ts` (`repoReferences`), `web/src/views/settings.messages.ts`
- Test: `web/src/app/settings-model.test.ts`, `web/src/components/settings/ReposSection.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`RepoJson.body`, `ToolArgs['repo_add' | 'repo_rm' | 'repo_check']`, `RepoCheckJson`), Task 5 (`SettingsSection`, `Field`, `ConfirmDialog formId`), `RepoPath`, `Markdown`, `IssueRef`, `parseRepoRef` (`@backe/core/names.ts`), `isRepoName`, `isGitRef`.
- Produces:

```ts
/** IDs der Issues, die das Repo per Name nennen (mit oder ohne Ref), nach `compareIssues`. */
export function repoReferences(issues: readonly IssueJson[], name: string): string[];
export function ReposSection(): JSX.Element;
```

Darstellung und Writes:
- Liste nach Name: Name (mono, Link auf den Tab Backlog mit `?repo=<name>`), URL, `default_ref`, Beschreibung als `Markdown` (ohne Issue-Kontext), mit Schreibrecht `RepoPath` (lokaler Pfad auf Klick) und Knopf »Entfernen«. Leere Liste → `noRepos`.
- »Hinzufügen« (Abschnitts-Aktion) → Dialog mit `url` (Pflicht), `name` (optional, `isRepoName`), `ref` (optional, `isGitRef`), Beschreibung (`Textarea`) → `repo_add`; leere optionale Felder gehen nicht mit. Ungültige Eingabe sperrt »Hinzufügen« und zeigt den Hinweis am Feld.
- »Entfernen« → `ConfirmDialog` destruktiv; nennt das Issue weiter `repoReferences` → Liste der `IssueRef`s, Text `repoStillReferenced`, Bestätigen gesperrt. Verschwindet das Repo per Patch, schließt der Dialog.
- »Prüfen« (Abschnitts-Aktion, nur mit Schreibrecht) mit Checkbox `remote` → `repo_check` mit `{remote: true}` falls gewählt; Ergebnis flüchtig im Komponentenzustand: je Repo die Befunde mit Stufe als Icon und Text (`error`/`warning`/`info` übersetzt), `github` (Sichtbarkeit, archiviert), `cached` (»aus dem Cache vom …«), dazu `notices`; ohne Befunde `checkClean`. Ein neuer Lauf ersetzt das Ergebnis.

- [ ] **Step 1: Failing tests**

```tsx
test('repo references match by name with or without ref', …repos ['core@main', 'web'] → repoReferences(…, 'core'));
test('repos list name, url, default ref and description', …);
test('adding a repo sends only filled fields', …url + name → call repo_add {url, name});
test('an invalid name blocks adding', …name 'Bad Name' → Knopf disabled, aria-invalid);
test('removing asks first and is blocked while issues refer to it', …);
test('removing an unreferenced repo calls repo_rm', …);
test('check shows findings per repo with their level', …Antwort mit error/warning → Texte; remote-Checkbox → {remote:true});
test('lists follow patches and a dialog of a vanished repo closes', …Patch upsert neues Repo → Zeile da; Dialog von core offen, Patch remove core → Dialog weg, keine Ausnahme);
```

- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** — `feat: Repositories in den Settings anlegen, prüfen und entfernen`

### Task 7: Abschnitte Projects und Sprints

**Files:**
- Create: `web/src/components/settings/ProjectsSection.tsx`, `web/src/components/settings/SprintsSection.tsx`
- Modify: `web/src/app/settings-model.ts` (`projectRows`, `projectReferences`, `sprintGroups`), `web/src/views/settings.messages.ts`
- Test: `web/src/app/settings-model.test.ts`, `web/src/components/settings/ProjectsSection.test.tsx`, `web/src/components/settings/SprintsSection.test.tsx`

**Interfaces:**
- Consumes: Task 1, Task 5, `isSettled`, `isProjectPath`, `isSprintSlug`, `Markdown`, `IssueRef`, `AssigneeSelect`-Muster für den `lead` (Auswahl aus den Users, »niemand«).
- Produces:

```ts
export type ProjectRow = { project: ProjectJson; depth: number; open: number; hasChildren: boolean };
/** Baum in Pfadordnung (`compareCodeUnits`), `open` rekursiv über Unterprojekte wie `project list`, je Issue einmal je Projekt. */
export function projectRows(projects: readonly ProjectJson[], issues: readonly IssueJson[]): ProjectRow[];
/** Issues, die genau diesen Pfad nennen (wie `project rm`). */
export function projectReferences(issues: readonly IssueJson[], path: string): string[];
/** Offene nach `start` absteigend (ohne `start` zuletzt), dann Slug; geschlossene ebenso. */
export function sprintGroups(sprints: readonly SprintJson[]): { open: SprintJson[]; closed: SprintJson[] };
export function ProjectsSection(): JSX.Element;
export function SprintsSection(): JSX.Element;
```

Projekte:
- Baumzeilen eingerückt (`depth`), Titel als Link auf den Tab Backlog mit `?project=<path>`, Pfad mono, `lead`, `open` als `openIssues(n)`; Beschreibung als `Markdown`.
- Mit Schreibrecht: Abschnitts-Aktion »Hinzufügen« und je Zeile »Unterprojekt« (Pfad vorbelegt `<path>/`) → Dialog `path` (Pflicht, `isProjectPath`), `title`, `lead` (Auswahl aus Users), Beschreibung → `project_create`. »Verschieben« → Dialog `to` (vorbelegt mit dem Pfad, `isProjectPath`, ≠ alt) → `project_mv`. »Entfernen« nur ohne Unterprojekte (`hasChildren` sperrt sicher, BK §2.9) → destruktiver Dialog; nennen Issues das Projekt, Pflichtwahl `reassign` (Auswahl der anderen Projekte) oder `detach` (Radio), sonst gesperrt → `project_rm`.

Sprints:
- Offene Sprints, dann ein Klappknopf `closedSprints(n)` (Default zu, flüchtig) mit den geschlossenen. Zeile: Titel als Link auf `?sprint=<slug>`, Slug mono, `start`–`end` (`formatDate` ohne Uhrzeit bzw. das Datum roh), Ziel (`body`) als `Markdown`.
- Mit Schreibrecht: »Hinzufügen« → Dialog `slug` (Pflicht, `isSprintSlug`), `title`, `start`, `end` (`<input type="date">`), Ziel → `sprint_create`. Je offenem Sprint »Schließen« → Dialog mit optionalem `carry_over` (Auswahl der anderen offenen Sprints, »keiner«) → `sprint_close`.

- [ ] **Step 1: Failing tests**

```tsx
test('project rows form a tree with recursive open counts', …web, web/auth, api; Issue in web/auth offen, eines done → web.open 1, web/auth.open 1, web.hasChildren true);
test('project references are exact paths', …);
test('sprint groups put open first by start descending', …);
test('projects show as a tree with lead and open issues', …);
test('creating a sub-project prefills its parent path', …Knopf Unterprojekt an web → Feld path 'web/'; Absenden → project_create {path:'web/ui', title:'UI'});
test('moving a project sends from and to', …);
test('a project with sub-projects cannot be removed', …kein Entfernen an web);
test('removing a referenced project needs reassign or detach', …gesperrt bis Wahl; reassign api → project_rm {path, reassign:'api'});
test('closed sprints stay folded until asked', …);
test('creating a sprint sends dates and goal', …sprint_create {slug, title, start:'2026-12-01', end:'2026-12-14', body});
test('closing a sprint can carry over to another open sprint', …sprint_close {slug, carry_over});
```

- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** — `feat: Projekte und Sprints in den Settings verwalten`

### Task 8: Abschnitt Users & Agents mit Policy-Ausblendung

**Files:**
- Create: `web/src/components/settings/UsersSection.tsx`
- Modify: `web/src/app/settings-model.ts` (`settingsRights`), `web/src/views/settings.messages.ts`
- Test: `web/src/app/settings-model.test.ts`, `web/src/components/settings/UsersSection.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`isAdmin` in der Hülle, `CreateAgentJson`), Task 5, `isHandle`, `CopyValue` (`components/issue/parts.tsx`), `formatDate`.
- Produces:

```ts
export type SettingsRights = {
  /** Mensch anlegen (`user_add` ohne `agent`). */
  addHuman: boolean;
  /** Agent per vorhandenem Key: `'any'` (Admin, Operator frei), `'self'` (Operator fest = ich), `false`. */
  addAgent: 'any' | 'self' | false;
  /** `user_create_agent`: Operator = ich, darum nur für menschliche User. */
  createAgent: boolean;
  revokeKey(user: UserJson): boolean;
  removeUser(user: UserJson): boolean;
};
export function settingsRights(input: {
  canWrite: boolean; me: string | null; users: readonly UserJson[]; config: Pick<BacklogConfig, 'admins'>;
}): SettingsRights;
export function UsersSection(): JSX.Element;
```

Regeln `settingsRights` (BK §2.12, §2.13 Punkt 4; ohne Schreibrecht oder ohne `me` alles `false`): `admin = isAdmin(config, me, meUser)`; `human = meUser?.kind === 'human'`. `addHuman = admin`; `addAgent = admin ? 'any' : human ? 'self' : false`; `createAgent = human`; `revokeKey(u) = admin || u.handle === me || (human && u.kind === 'agent' && u.operator === me)`; `removeUser(u) = admin && !u.admin && u.handle !== me && kein User nennt u.handle als operator`.

Darstellung und Writes:
- Tabelle bzw. Karten je User nach Handle: Handle mono, Name, Art (`human`/`agent` übersetzt), `admin`-Marke, Operator, aktive Fingerprints (mono, je mit »Widerrufen«, falls `revokeKey`), widerrufene Keys (Fingerprint durchgestrichen + `revokedAt(date)`).
- »User hinzufügen« (bei `addHuman || addAgent`) → Dialog: `handle` (Pflicht, `isHandle`), `name`, Public-Key-Zeile (Pflicht, `Textarea` einzeilig, beginnt mit `ssh-ed25519 `), Art Radio `human`/`agent` (`human` nur bei `addHuman`; ohne ihn fest `agent`), bei `agent` `operator`: Auswahl der Menschen bei `'any'`, fest `me` als Text bei `'self'` → `user_add` mit `agent: true, operator` bzw. ohne beides.
- »Agent anlegen« (bei `createAgent`) → Dialog `handle`, `name`, Hinweis `createAgentHint` (Key entsteht auf diesem Rechner unter `~/.backe/keys/…`) → `user_create_agent`; danach im Dialog `keyPathCreated` mit `CopyValue(key_path)` und »Schließen« statt sofortigem Zuklappen.
- »Widerrufen« → destruktiver Dialog mit Fingerprint und `revokeFinal` (endgültig) → `user_revoke_key {handle, fingerprint}`. »Entfernen« (bei `removeUser`) → destruktiver Dialog → `user_rm`.

- [ ] **Step 1: Failing tests**

```tsx
test('rights follow the identity protection', …Tabelle: admin spw; Mensch ana; Agent bot (operator ana) — als spw: addHuman, addAgent 'any', removeUser(ana) false (Operator), removeUser(bot) true, removeUser(spw) false; als ana: addHuman false, addAgent 'self', createAgent true, revokeKey(bot) true, revokeKey(spw) false, removeUser(*) false; als bot: alles false außer revokeKey(bot); canWrite false → alles false);
test('an agent listed in admins is no admin', …);
test('users show kind, operator, fingerprints and revoked keys', …);
test('a member sees only agent creation with himself as operator', …als ana: kein Radio human, Operator fest 'ana'; Absenden → user_add {handle, key, agent:true, operator:'ana'});
test('an admin adds a human with a pasted key', …user_add {handle, key, name});
test('creating an agent shows where the key lies', …Antwort key_path → Text und Kopieren);
test('revoking a key asks first', …user_revoke_key {handle, fingerprint});
test('removing a user asks first and is hidden where policy refuses', …);
```

- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** — `feat: Users und Agents in den Settings, Aktionen nach dem Identitätsschutz`

### Task 9: Nur lesen über Settings und Suche, Budget

**Files:**
- Modify: `web/src/components/read-only.test.tsx`
- Test: dieselbe Datei

- [ ] **Step 1: Failing tests** (Muster der Datei: `mountApp` mit `can_write: false`, `fetch` schreibt mit; Gegentest mit `can_write: true`)

```tsx
test('read-only hides settings writes', …Route /b/acme/settings (findBy wegen Lazy-Chunk): keine Knöpfe Hinzufügen/Unterprojekt/Verschieben/Entfernen/Schließen/Widerrufen/Prüfen/Jetzt synchronisieren/Lokaler Pfad; Theme-Radio und Sprachwahl bedienbar; kein Aufruf auf /tools/);
test('the same settings offer every write with write access', …dieselben Namen sind da);
test('search works read-only, descriptions included', …Strg+K, Text, »In Beschreibungen suchen« → GET /search, kein /tools/);
```

- [ ] **Step 2: Run** → FAIL nur, falls etwas durchrutscht; dann im Abschnitt beheben
- [ ] **Step 3: Run** `pnpm vitest run --project web` → PASS; `pnpm build` → Budget gehalten; Größen notieren (initial, Settings-Chunk)
- [ ] **Step 4: Commit** — `test: Settings und Suche ohne Schreibrecht`

### Task 10: Sichtprüfung, Docs

**Files:**
- Modify: `docs/proposals/ui.md` (Status-Satz, §2.3.1, §2.6, §2.10, §2.11, §2.14), `ROADMAP.md`, `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (U10 »Produziert«), dieser Plan (Häkchen)

- [ ] **Step 1: Run** `mise run check` und `mise run smoke` → grün
- [ ] **Step 2: Sichtprüfung** — `backe ui --port 0` gegen ein Test-Backlog unter Temp-`BACKE_HOME` im Browser (Playwright-MCP), hell und dunkel: Settings mit allen Abschnitten, Navigation links ab `lg`, Klappen; Repo anlegen, prüfen, entfernen; Projekt- und Unterprojekt anlegen, verschieben, entfernen mit `reassign`; Sprint anlegen, schließen mit `carry_over`; Agent anlegen; Key widerrufen; `sync_now`; Sprache umstellen; externe Bilder blocken; Default-Gruppierung im Board; `⌘K`/Strg+K, Gruppen, exakte ID, Beschreibungssuche; zweite Identität ohne Key → nur lesen. Ein `.playwright-mcp`-Verzeichnis im Haupt-Checkout danach entfernen.
- [ ] **Step 3: Docs** — ui.md Status: Settings ohne Browser-Benachrichtigungen und Suche gebaut; offen bleiben §2.4.1 Punkt 3 und »Browser-Benachrichtigungen« in §2.10. Als Gegenwart nachziehen: §2.3.1 Einträge von `projects`, `sprints`, `repos` tragen `body` (fehlt, wenn leer); §2.10 Oberfläche um »externe Bilder« (§4.1) und die Bedeutung der Default-Gruppierung (für Boards ohne eigene Wahl), Abschnitte per Route aufklappen, Klappzustand im `localStorage`, `backlog.jsonc` und Sync-Status lesend, Policy-Ausblendung nach BK §2.13; §2.11 Trefferregeln (Kurzform ab 3 Zeichen, Titelwörter mit Anfang, Teilwort und einem Tippfehler, Reihenfolge, Auswahl je Art, Beschreibungs-Treffer als eigene Gruppe, Esc); §2.14 Wahl im `localStorage`, Wechsel rendert neu. ROADMAP »Settings und Suche« abhaken. Gesamtplan U10 »Produziert«.
- [ ] **Step 4: Commit** — `docs: Settings und Suche in ui.md, Roadmap und Gesamtplan nachgezogen`

## Festlegungen

| Stelle | Festlegung |
| --- | --- |
| Beschreibungen von Projekten, Sprints, Repos | ui.md §2.10 nennt das Sprint-Ziel, §2.9.2 rendert diese Beschreibungen; `/state` hatte sie nicht. Sie stehen als `body` in den Einträgen von `/state` und den Patches (wie `sprint show --format json`), Issue-Bodies weiterhin nicht (§3.4). Kein eigener Endpunkt. |
| Unscharfe Suche | Titelwörter treffen über Gleichheit, Wortanfang, Teilwort oder ab 4 Zeichen mit einem Tippfehler (Damerau-Levenshtein 1). Kein Index-Paket. |
| Auswahl eines Users | öffnet den Tab Backlog mit `assignee=<handle>`: Wer einen User sucht, will meist seine Issues. |
| Beschreibungs-Suche | Ergebnisse als eigene Gruppe am Ende derselben Liste, ebenfalls höchstens 8. |
| Sprache | Wahl `server`/`en`/`de` global im `localStorage`; ein Wechsel mountet Kopfzeile und Ansicht neu, die Sitzung bleibt. |
| Externe Bilder | Schalter global; blockiert wird im Markdown-Renderer (statt Bild ein Link mit Hinweis), die CSP bleibt wörtlich. |
| Default-Gruppierung | Global; gilt für Boards ohne gespeicherte eigene Wahl. Die Wahl im Board bleibt je Backlog. |
| Settings-Abschnitte | Slugs `repositories`, `projects`, `sprints`, `users`, `backlog`, `interface`; alle untereinander, die Route klappt einen auf und rückt ihn ins Bild. |
| Policy-Ausblendung | Client-Regel `settingsRights` nach BK §2.13 Punkt 4; was die Regel nicht sicher weiß (früher entfernte Handles), bleibt sichtbar und scheitert mit Meldung. Zusätzlich gesperrt, was der Service sicher ablehnt: Projekt mit Unterprojekten entfernen (fehlt), Repo mit Verweisen entfernen (Dialog gesperrt). |
| Settings als Chunk | `SettingsView` lädt per `React.lazy` hinter `ChunkBoundary`; die Suche bleibt im Hauptchunk, weil sie in jeder Ansicht steht. |
