# backe ui U6 — Tab Issue lesend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Issue-Tab zeigt ein Issue vollständig und live — Felder, Beziehungen, Beschreibung als bereinigtes Markdown mit Highlighting und Mermaid, Zeitleiste aus Kommentaren und Transitionen, Anhänge mit Vorschau — ohne Schreibaktionen.

**Architecture:** Drei Schichten wie U5. Felder und Beziehungen kommen live aus dem Store (`issueRelations` über `@backe/ops/graph.ts` auf `store.toSnapshot()`), Body, Kommentare und die Anhangsliste aus `GET …/issues/<id>` und dem neuen `GET …/issues/<id>/attachments`; `IssueDetailModel` lädt beides neu, sobald `store.touchCount(id)` steigt. `web/src/markdown/` ist die wiederverwendbare `<Markdown>`-Komponente (U7, U10): `react-markdown` mit GFM, Emoji-Shortcodes, `rehype-raw` und `rehype-sanitize`, Issue-ID-Links und Anhangspfaden; Markdown, Highlighting-Sprachen und Mermaid sind eigene Lazy-Chunks.

**Tech Stack:** wie U5. Neu als `devDependencies` (aktuelle Releases, Caret; Versionen beim Installieren in die Commit-Message): `react-markdown`, `remark-gfm`, `remark-gemoji`, `rehype-raw`, `rehype-sanitize`, `mdast-util-find-and-replace`, `lowlight`, `highlight.js`, `hast-util-to-jsx-runtime`, `mermaid`. shadcn-Komponente `dialog` per `pnpm dlx shadcn@4.23.1 add dialog`.

**Spec:** `docs/proposals/ui.md` §2.9 (Kopf), §2.9.1 ohne »Bearbeiten« und »Aktionen«, §2.9.2 »Rendering«, »Rohes HTML«, »Issue-IDs«, »Relative Bildpfade«, »Mermaid«, §2.9.3 erster und dritter Punkt, §2.9.4 ohne Hochladen und Entfernen, §2.6 »Gelöschtes Issue«, §2.13, §2.15 »Anhänge« und »Markdown«, §2.16 »Code-Splitting«, §5 »Client« (Markdown). BK `docs/proposals/backe.md` §2.6, §2.7, §2.8, §2.22–§2.24. Gesamtplan `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md`. ui.md ist `in Umsetzung`.

## Global Constraints

Alle Global Constraints des Gesamtplans und der Pläne U1–U5. Dazu für U6:

- Beziehungen (Parents bis zur Wurzel, `blocked_by`, `depends_on`, `dependents`, Sub-Issues, Fortschritt) nur über `graphOf`, `ancestors`, `childProgress` aus `@backe/ops/graph.ts` und `compareIssues` aus `@backe/ops/order.ts`; keine zweite Graph-Logik im Client. Ergebnis gleich `issue show --format json` (Paritätstest Task 2).
- Sanitize mit `defaultSchema` aus `rehype-sanitize` (GitHub-Stil) ohne Erweiterung; Reihenfolge `rehype-raw` → `rehype-sanitize`. URLs laufen danach durch `issueUrlTransform` (Task 3), das `defaultUrlTransform` von `react-markdown` einschließt.
- Issue-ID-Links nur für `<config.id_prefix>-[0-9a-hjkmnp-tv-z]{5,6}` mit Wortgrenzen, nur wenn die ID im Store steht, nie in Code, Inline-Code oder bestehenden Links. Ziel `routeHref({kind: 'issue', …})`, Klick über `useLinkClick`.
- Relative Pfade (`attachments/<file>`, `./attachments/<file>`) zeigen auf `/api/b/<b>/issues/<id>/attachments/<name>`, wenn ein Anhang des Issues genau diese `file` hat; jeder andere relative Pfad (auch mit `..`) fällt weg. Externe `http(s)`-Links öffnen mit `target="_blank" rel="noopener noreferrer"`.
- Mermaid: `import('mermaid')` erst, wenn der Block per `IntersectionObserver` sichtbar wird; `initialize({ startOnLoad: false, securityLevel: 'strict', theme })` mit `theme` `'neutral'` (hell) bzw. `'dark'` aus `data-theme` auf `<html>`; Theme-Wechsel rendert neu.
- Highlighting ohne Farbe (ui.md §2.13): Tokens unterscheiden sich über Gewicht, Kursiv und die Tokens `foreground`/`muted-foreground`. Sprachen laden einzeln aus `LANGUAGES` (Task 4); unbekannte Sprache → unformatierter Code.
- Anhänge: Vorschau als Bild nur für `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `svg` (immer `<img>`, nie `<object>`/`<iframe>`); Text-Vorschau nur bei `size ≤ 262144` **und** Antwort mit `Content-Type: text/plain`; `.md` gerendert mit `<Markdown>`; sonst Download-Link. Die Grenze kommt als `ATTACHMENT_TEXT_LIMIT` aus einem reinen Modul, nicht als zweite Zahl.
- Zeitpunkte über `Intl.DateTimeFormat(<Locale>, { dateStyle: 'medium', timeStyle: 'short' })` in `<time dateTime>`; Größen über `Intl.NumberFormat` als `B`, `KiB`, `MiB`.
- Neue Texte en + de in `web/src/views/issue.messages.ts`. State-Namen, IDs, Handles, Property-Keys und Pfade bleiben roh.

## Review Focus

1. **Feindliches Markdown** — `<script>`, `<img src=x onerror=alert(1)>`, `[x](javascript:alert(1))`, `<a href="data:text/html,…">`, `<iframe>`, `<style>`, `<details><summary>` dazwischen. Erwartet: aktiver Inhalt weg, `details`/`summary` bleiben, kein `on*`-Attribut im DOM. → Task 3 `strips active content`, `keeps details and summary`.
2. **Antworten in falscher Reihenfolge** — zwei Patches kurz hintereinander, die Antwort des ersten Ladens kommt nach der des zweiten; oder 404, weil das Issue inzwischen gelöscht ist. Erwartet: nur die jüngste Antwort zählt; 404 nach dem Löschen zeigt »gelöscht«, keinen Fehler. → Task 2 `stale detail answers are ignored`, `a 404 after delete is deleted`.
3. **Pfade, die aus dem Issue hinauszeigen** — `![a](../bk-x/attachments/a.png)`, `attachments/../issue.md`, `attachments/unbekannt.png`. Erwartet: kein Request, das Bild fällt weg. → Task 3 `only own attachment files resolve`.
4. **Kaputtes Diagramm** — Mermaid-Syntaxfehler, Theme-Wechsel während des Renderns. Erwartet: Quelltext plus Fehlermeldung; nach dem Theme-Wechsel genau ein Diagramm im neuen Theme. → Task 4 `a syntax error shows source and message`, `a theme change renders again`.
5. **Issue mit kaputtem Frontmatter in einem offenen Tab** — Hand-Edit macht das Issue zu einem `problem`. Erwartet: die Problemmeldung statt »gelöscht«, nach dem Fix der normale Tab. → Task 5 `a broken issue shows its problem`.

---

### Task 1: Server — Anhangsliste mit Größe und LFS-Status, API-Typen

**Files:**
- Modify: `src/services/attachments.ts` (`AttachmentView.not_loaded`, `listAttachments`)
- Modify: `src/ui/routes.ts` (Route `attachments`), `src/ui/read-api.ts`
- Modify: `src/ui/api.ts` (`IssueDetailJson`, `CommentJson`, `IssueRefJson`, `AttachmentListJson`)
- Modify: `docs/proposals/ui.md` §2.3.1, §2.9; `docs/proposals/backe.md` §2.8 »Nicht geladene Anhänge«
- Test: `src/services/attachments.test.ts`, `src/ui/read-api.test.ts`, `src/ui/routes.test.ts`

**Interfaces:**
- Produces: `GET /api/b/<b>/issues/<id>/attachments` → JSON wie `attach list <id> --format json`: `[{name, file?, url?, size?, not_loaded?}]`. `not_loaded: true` nur, wenn `attachments.lfs: true` gilt und die Datei ein LFS-Pointer ist (dieselbe Prüfung wie `getAttachment`). Typen in `api.ts`:

```ts
export type IssueRefJson = { id: string; state: State; title: string; assignee?: string };
export type CommentJson = { file: string; author: string; created: string;
  kind?: 'transition'; from?: State; to?: State; body: string };
/** `issue show --comments all --format json`; leere Listen und leerer Body fehlen. */
export type IssueDetailJson = Omit<IssueJson, 'depends_on'> & {
  depends_on?: (IssueRefJson | { id: string; missing: true })[];
  body?: string; parents?: IssueRefJson[]; dependents?: IssueRefJson[]; children?: IssueRefJson[];
  progress?: { settled: number; total: number }; comments_count: number;
  last_reason?: CommentJson; comments?: CommentJson[];
  notices?: { code: string; message: string; ids: string[] }[];
};
export type AttachmentListJson = { name: string; file?: string; url?: string; size?: number; not_loaded?: true }[];
```

- [ ] **Step 1: Failing tests**

```ts
// attachments.test.ts
test('list marks lfs pointers as not loaded', …lfs: true, Datei mit Pointer-Kopfzeile → { name, file, size, not_loaded: true });
test('list ignores pointer text without lfs', …lfs: false → kein not_loaded);
// routes.test.ts
test('attachment list route', …'/api/b/acme/issues/bk-7f3k2/attachments' → { kind: 'attachments', backlog: 'acme', id: 'bk-7f3k2' });
// read-api.test.ts
test('attachment list equals attach list --format json', …Body gleich dem CLI-JSON desselben Backlogs);
test('attachment list of an unknown issue is 404', …);
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm vitest run src/services/attachments.test.ts src/ui`
- [ ] **Step 3: Implement** — `listAttachments` prüft `isLfsPointer` nur bei `headConfig(root)?.attachments.lfs === true`; die CLI-Textausgabe bleibt unverändert, die JSON-Golden-Files ändern sich nicht (keine Fixture hat LFS-Pointer). `api.ts` bleibt `import type`-only.
- [ ] **Step 4: Docs** — ui.md §2.3.1 neue Zeile nach `/issues/<id>`: »`GET /api/b/<b>/issues/<id>/attachments` | wie `attach list <id> --format json`: Name, Datei oder URL, Größe; `not_loaded` bei nicht geladenen LFS-Anhängen (BK §2.8)«. ui.md §2.9 Kopfabsatz ersetzen durch: »Ein Issue-Tab zeigt Felder und Beziehungen aus dem Client-Store (§2.5, §3.5), Beschreibung und Zeitleiste aus `GET …/issues/<id>`, Anhänge aus `GET …/issues/<id>/attachments`. Beide lädt er neu, wenn ein Patch das Issue in `upsert` oder `touched` nennt, und nach jedem Neuladen von `/state`.« backe.md §2.8 »Nicht geladene Anhänge«: Satz anhängen »`attach list --format json` kennzeichnet sie mit `not_loaded: true`.«
- [ ] **Step 5: Run** `pnpm vitest run src test` → PASS; `mise run check` grün.
- [ ] **Step 6: Commit** — `feat: Anhangsliste der UI mit Größe und nicht geladenen LFS-Anhängen`

### Task 2: Detailmodell und Beziehungen aus dem Store

**Files:**
- Create: `web/src/data/issue-api.ts`, `web/src/app/issue-relations.ts`, `web/src/app/issue-detail.ts`
- Modify: `test/helpers/web-closure.ts` (`src/ops/order.ts` in `WEB_ENTRIES`, falls nicht schon über `graph.ts` in der Hülle)
- Test: `web/src/app/issue-relations.test.ts`, `web/src/app/issue-relations.parity.test.ts` (`// @vitest-environment node`), `web/src/app/issue-detail.test.ts`

**Interfaces:**
- Consumes: Task 1 (`IssueDetailJson`, `AttachmentListJson`), `Store.touchCount`, `Store.toSnapshot`, `getJson`, `ApiError`.
- Produces:

```ts
// data/issue-api.ts
export function fetchIssue(backlog: string, id: string, fetchFn?: Fetch): Promise<IssueDetailJson>;
export function fetchAttachments(backlog: string, id: string, fetchFn?: Fetch): Promise<AttachmentListJson>;
export function attachmentUrl(backlog: string, id: string, name: string): string; // encodeURIComponent je Segment
// app/issue-relations.ts
export type IssueRelations = {
  parents: IssueRefJson[];               // von der Wurzel zum direkten Parent, wie `issue show`
  blockedBy: IssueRefJson[]; dependsOn: (IssueRefJson | { id: string; missing: true })[];
  dependents: IssueRefJson[]; children: IssueRefJson[];
  progress?: { settled: number; total: number };
};
export function issueRelations(s: BacklogSnapshot, id: string): IssueRelations | undefined;
// app/issue-detail.ts
export type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; detail: IssueDetailJson; attachments: AttachmentListJson }
  | { status: 'deleted' }
  | { status: 'error'; error: ApiError };
export class IssueDetailModel {
  constructor(store: Store, id: string, load: {
    issue: (id: string) => Promise<IssueDetailJson>;
    attachments: (id: string) => Promise<AttachmentListJson>;
  });
  readonly state: SignalReader<DetailState>;
  readonly relations: SignalReader<IssueRelations | undefined>;   // Memo über toSnapshot
  dispose(): void;
}
```

Regeln: Laden beim Erzeugen und bei jedem Anstieg von `store.touchCount(id)`, Issue und Anhänge parallel. Jede Ladung trägt eine laufende Nummer; nur die Antwort der jüngsten zählt. Während eines Neuladens bleibt `ready` mit den alten Daten stehen. `deleted`, wenn der Store geladen ist, das Issue fehlt und kein `problem` mit `key === id` existiert, oder wenn eine Ladung 404 `not_found` bringt und der Store das Issue nicht mehr hat. Ein `problem` mit `key === id` ist `error` mit dessen `message`.

- [ ] **Step 1: Failing tests**

```ts
// issue-relations.test.ts (Fixtures wie src/ops/graph.test.ts)
test('parents run from the root', …expect(r.parents.map(id)).toEqual([ROOT, MID]));
test('depends_on keeps file order and marks missing ids', …);
test('dependents and children sorted like issue show', …);
// issue-relations.parity.test.ts — echtes Backlog wie list-filter.parity.test.ts
test.each(ids)('relations of %s equal issue show', …issueRelations(store.toSnapshot(), id)
  gleich den Feldern parents, blocked_by (als Refs), depends_on, dependents, children, progress aus issueShowJson);
// issue-detail.test.ts
test('loads detail and attachments once', …);
test('a touch reloads', …applyPatch mit touched: [id] → zweiter Aufruf beider Loader);
test('a patch on another issue does not reload', …);
test('stale detail answers are ignored', …erste Antwort nach der zweiten → state zeigt die zweite);
test('a 404 after delete is deleted', …remove.issues: [id], Loader wirft 404 → 'deleted');
test('a broken issue is an error with the problem message', …);
test('relations update live', …depends_on eines anderen Issues auf id → relations().dependents enthält es);
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm vitest run --project web web/src/app/issue-*`
- [ ] **Step 3: Implement** — `issueRelations` spiegelt `showIssue` (`src/services/issue-show.ts`) auf dem Snapshot; `blockedBy` nimmt nur existierende IDs wie dort. `IssueDetailModel` mit `createEffect` auf `touchCount(id)`, alle Signale per `attach: this`, `dispose` über `SignalGroup.delete`.
- [ ] **Step 4: Run** → PASS; `pnpm vitest run test/conventions.test.ts` (Hülle) → PASS
- [ ] **Step 5: Commit** — `feat: Detailmodell des Issue-Tabs, Beziehungen live aus dem Store`

### Task 3: `<Markdown>` — GFM, Emoji, Bereinigung, Issue-Links, Anhangspfade

**Files:**
- Create: `web/src/markdown/Markdown.tsx` (Default-Export, Lazy-Chunk), `web/src/markdown/index.tsx` (`Markdown` als `React.lazy` mit `Suspense`-Fallback: Quelltext in `whitespace-pre-wrap`), `web/src/markdown/issue-links.ts`, `web/src/markdown/url-transform.ts`, `web/src/markdown/markdown.css`
- Modify: `package.json`, `pnpm-lock.yaml`
- Test: `web/src/markdown/Markdown.test.tsx`, `web/src/markdown/url-transform.test.ts`, `web/src/markdown/issue-links.test.ts`

**Interfaces:**
- Consumes: `useStore`, `useSignal`, `useLinkClick`, `routeHref`, `attachmentUrl` (Task 2), `Attachment` (`@backe/core/schemas.ts`).
- Produces:

```tsx
export type MarkdownProps = {
  source: string;
  backlog: string;
  /** Kontext für relative Pfade; ohne ihn (Projekt, Sprint, Repo) fallen relative Pfade weg. */
  issue?: { id: string; attachments: readonly Attachment[] };
  className?: string;
};
export function Markdown(props: MarkdownProps): JSX.Element;      // aus index.tsx, lazy
// url-transform.ts
export function issueUrlTransform(ctx: { backlog: string; issue?: MarkdownProps['issue'] }):
  (url: string, key: string) => string | null | undefined;
// issue-links.ts — remark-Plugin
export function remarkIssueLinks(opts: { prefix: string; exists: (id: string) => boolean; href: (id: string) => string }): (tree: Root) => void;
```

Plugins: `remarkPlugins: [remarkGfm, remarkGemoji, [remarkIssueLinks, …]]`, `rehypePlugins: [rehypeRaw, [rehypeSanitize, defaultSchema]]`. Komponenten-Overrides: `a` (intern → `useLinkClick`, extern → `target`/`rel`), `code` (Block mit `language-*` → `CodeBlock`/`MermaidBlock` aus Task 4; bis dahin `<pre><code>`), `input` bleibt `disabled` (Task-Listen nur lesend). `prefix` aus `store.config.id_prefix`; `exists` liest `store.issues.keys`. Typografie in `markdown.css` (Überschriften, Listen, Tabellen mit Rahmen, Blockquote, Code in Monospace), keine Farbe außer Graustufen.

- [ ] **Step 1: Failing tests**

```tsx
test('renders gfm', …Tabelle → <table>, ~~x~~ → <del>, Task-Liste → input[type=checkbox][disabled], www.example.com → <a>);
test('renders emoji shortcodes', …':tada:' → '🎉');
test('strips active content', () => {
  // <script>, <img src=x onerror=…>, [x](javascript:alert(1)), <a href="data:text/html,…">, <iframe>, <style>
  expect(container.querySelector('script, iframe, style')).toBeNull();
  expect([...container.querySelectorAll('*')].flatMap((e) => e.getAttributeNames()).filter((n) => n.startsWith('on'))).toEqual([]);
  expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).not.toContainEqual(expect.stringMatching(/^(javascript|data):/));
});
test('keeps details and summary', …);
test('links existing issue ids', …'siehe bk-7f3k2' → <a href="/b/acme/issue/bk-7f3k2">; Klick → router.location.pathname);
test('ids in code stay text', …'`bk-7f3k2`' und Codeblock → kein <a>);
test('unknown ids and foreign prefixes stay text', …'bk-zzzzz', 'xy-7f3k2');
test('relative image paths point at the attachment', …'![t](attachments/trace.png)' mit Anhang {name: 'trace', file: 'trace.png'} → src '/api/b/acme/issues/bk-7f3k2/attachments/trace');
test('only own attachment files resolve', …'../bk-x/attachments/a.png', 'attachments/../issue.md', 'attachments/unbekannt.png' → kein <img> mit src);
test('external links open in a new tab', …target="_blank", rel enthält noopener und noreferrer);
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm vitest run --project web web/src/markdown`
- [ ] **Step 3: Install** `pnpm add -D react-markdown remark-gfm remark-gemoji rehype-raw rehype-sanitize mdast-util-find-and-replace`; implementieren. `remarkIssueLinks` über `findAndReplace` mit `ignore: ['link', 'linkReference', 'inlineCode', 'code']`.
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** — `feat: Markdown-Komponente mit Bereinigung, Issue-Links und Anhangspfaden`

### Task 4: Code-Highlighting und Mermaid als Lazy-Chunks

**Files:**
- Create: `web/src/markdown/CodeBlock.tsx`, `web/src/markdown/languages.ts`, `web/src/markdown/highlight.css`, `web/src/markdown/MermaidBlock.tsx`, `web/src/lib/use-resolved-theme.ts`
- Modify: `web/src/markdown/Markdown.tsx` (Overrides), `package.json`, `pnpm-lock.yaml`
- Test: `web/src/markdown/CodeBlock.test.tsx`, `web/src/markdown/MermaidBlock.test.tsx`, `web/src/lib/use-resolved-theme.test.ts`

**Interfaces:**
- Produces:

```ts
// languages.ts — je Sprache ein dynamischer Import, Aliasse auf denselben Eintrag
export const LANGUAGES: Readonly<Record<string, () => Promise<{ default: LanguageFn }>>>;
export function languageOf(nameOrExtension: string): string | undefined;   // 'ts' → 'typescript', 'yml' → 'yaml'
// CodeBlock.tsx
export function CodeBlock(props: { code: string; language?: string }): JSX.Element;
// MermaidBlock.tsx
export function MermaidBlock(props: { source: string }): JSX.Element;
// use-resolved-theme.ts — liest data-theme von <html>, folgt per MutationObserver
export function useResolvedTheme(): 'light' | 'dark';
```

`LANGUAGES` deckt mindestens ab: `bash`/`sh`/`shell`, `css`, `diff`, `dockerfile`, `go`, `html`/`xml`/`svg`, `ini`/`toml`, `java`, `javascript`/`js`/`jsx`/`mjs`, `json`/`jsonc`, `markdown`/`md`, `python`/`py`, `rust`/`rs`, `sql`, `typescript`/`ts`/`tsx`, `yaml`/`yml`. `CodeBlock` zeigt sofort den unformatierten Code und ersetzt ihn, sobald `lowlight` und die Sprache geladen sind (`hast-util-to-jsx-runtime`, kein `innerHTML`). `MermaidBlock` zeigt bis zur Sichtbarkeit den Quelltext als Code; das SVG aus `mermaid.render` kommt per `innerHTML` in einen Container (Mermaid bereinigt es selbst unter `strict`).

- [ ] **Step 1: Failing tests**

```tsx
test('unknown language stays plain', …kein .hljs-* im DOM);
test('known language highlights after loading', async …await findByText → .hljs-keyword vorhanden);
test('extensions map to languages', …languageOf('yml') === 'yaml', languageOf('tsx') === 'typescript');
// MermaidBlock: vi.mock('mermaid'), IntersectionObserver-Stub
test('mermaid loads only when visible', …vor dem Intersect kein import, danach render aufgerufen);
test('mermaid runs strict and follows the theme', …initialize mit securityLevel 'strict', theme 'neutral' bzw. 'dark');
test('a theme change renders again', …data-theme wechseln → render erneut, genau ein svg im Container);
test('a syntax error shows source and message', …render wirft → Quelltext und Fehlertext sichtbar);
// Markdown.test.tsx
test('mermaid fences become diagrams', …```mermaid → MermaidBlock);
```

- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Install** `pnpm add -D lowlight highlight.js hast-util-to-jsx-runtime mermaid`; implementieren. `highlight.css` nach ui.md §2.13 ohne Farbe.
- [ ] **Step 4: Run** `pnpm vitest run --project web` → PASS; `pnpm build` → `scripts/check-ui-build.ts` grün (Mermaid, `lowlight` und Sprachen nicht im initialen Chunk).
- [ ] **Step 5: Commit** — `feat: Highlighting mit Sprachen auf Abruf und Mermaid als eigene Chunks`

### Task 5: Ansicht — Kopf, Felder, Beziehungen, Zeitleiste

**Files:**
- Create: `web/src/views/issue.messages.ts`, `web/src/components/issue/IssueFields.tsx`, `web/src/components/issue/IssueRelations.tsx`, `web/src/components/issue/Timeline.tsx`, `web/src/components/issue/IssueRef.tsx`, `web/src/lib/format.ts`
- Modify: `web/src/views/IssueView.tsx`, `web/src/components/App.tsx` (`backlog` und `onClose` an `IssueView`)
- Test: `web/src/views/IssueView.test.tsx`, `web/src/lib/format.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4, `StateIcon`, `Badge`, `ErrorAlert`, `useOwned`.
- Produces: `<IssueView backlog={string} id={string} onClose={(id: string) => void} />`; `<IssueRef issue={IssueRefJson | {id, missing: true}} backlog={string} />` (Link mit `StateIcon`, ID, Titel; U9 nutzt es wieder); `formatDate(iso: string): string`, `formatBytes(n: number): string`.

Aufbau nach ui.md §2.9.1 und `issue-details.png`, zwei Spalten ab `md`, darunter Beschreibung, Anhänge (Task 6) und Zeitleiste:

- **Links** (`<dl>`): ID in Monospace mit Kopier-Knopf (`navigator.clipboard.writeText`, Bestätigung per Live-Region), Titel als `<h1>`, State per `StateIcon` samt `last_reason` (Markdown, gekürzt auf die Begründung), Assignee, Creator, `created`, Rank, Projekte, Sprints, Repos (Name und Ref), Parents als Pfad aus `IssueRef`, Properties (Key roh, Wert als JSON-Text bei Objekten; bei deklarierten Properties `description` als Hilfetext).
- **Rechts:** `blocked_by`, `depends_on` (fehlende ID als »fehlt«), `dependents`, Sub-Issues mit `{settled}/{total} erledigt`. Leere Gruppen fehlen.
- **Zeitleiste** (`<ol>`): Einträge in Server-Reihenfolge; Transition als `from → to` mit `StateIcon`s und Begründung, Kommentar mit Autor (Handle; `title` = Name aus `store.users`), Zeitpunkt, Markdown-Body.
- **Zustände:** `loading` → »Lädt …« (Felder aus dem Store stehen schon); `deleted` → Hinweis »gelöscht« mit Knopf »Tab schließen« (`onClose(id)`), letzte Daten bleiben sichtbar abgeschwächt; `error` → `ErrorAlert` mit `hint`.

- [ ] **Step 1: Failing tests**

```tsx
test('shows fields from the store', …ID, Titel, State-Name, Assignee, Projekte, Property mit description);
test('shows relations with states', …depends_on-Link mit StateIcon, fehlende ID als »fehlt«, Fortschritt '1/2');
test('a related issue opens its tab', …Klick → /b/acme/issue/<id>);
test('timeline lists comments and transitions in order', …);
test('reloads on a touch', …applyPatch touched → neuer Kommentar erscheint);
test('a deleted issue keeps its tab', …remove → »gelöscht«, Knopf ruft onClose(id));
test('a broken issue shows its problem', …problems: [{key: id, message}] → Meldung, nicht »gelöscht«; Fix-Patch → Felder);
test('copy puts the id on the clipboard', …);
test('format bytes and dates in both languages', …formatBytes(1536) en '1.5 KiB', de '1,5 KiB');
```

- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** `pnpm vitest run --project web` → PASS
- [ ] **Step 5: Commit** — `feat: Issue-Tab mit Feldern, Beziehungen und Zeitleiste`

### Task 6: Anhänge, Sichtprüfung, Docs

**Files:**
- Create: `web/src/components/ui/dialog.tsx` (shadcn), `web/src/components/issue/Attachments.tsx`, `web/src/app/attachment-kind.ts`
- Create: `src/tools/limits.ts` — nur `export const ATTACHMENT_TEXT_LIMIT = 262_144`; `src/tools/read.ts` re-exportiert es; `src/tools/limits.ts` in `WEB_ENTRIES`
- Modify: `web/src/views/IssueView.tsx`, `test/helpers/web-closure.ts`
- Modify: `docs/proposals/ui.md` (Status-Satz), `ROADMAP.md`, `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (U7 übernimmt den Repo-Pfad, s. u.)
- Test: `web/src/components/issue/Attachments.test.tsx`, `web/src/app/attachment-kind.test.ts`

**Interfaces:**
- Consumes: `AttachmentListJson`, `attachmentUrl`, `Markdown`, `CodeBlock`, `languageOf`, `formatBytes`, `store.context` (`backlog.root` für den LFS-Hinweis).
- Produces:

```ts
export type AttachmentKind = 'image' | 'markdown' | 'text' | 'download' | 'url' | 'not-loaded';
export function attachmentKind(a: AttachmentListJson[number]): AttachmentKind;
```

Regeln: `url` → Link mit Hostname (`new URL(url).hostname`); `not_loaded` → Hinweis `git -C <root> lfs pull`; Bild-Endung → `<img loading="lazy">`, Klick öffnet `Dialog` mit großer Ansicht (Esc schließt); `.md`/`.markdown` mit `size ≤ ATTACHMENT_TEXT_LIMIT` → `markdown`; sonst `size ≤ ATTACHMENT_TEXT_LIMIT` → `text`; sonst `download`. `text` und `markdown` holen die Bytes per `fetch`; ist der `Content-Type` nicht `text/plain`, fällt der Eintrag auf `download` zurück. Text in `CodeBlock` mit `languageOf(Endung)`, einklappbar (`<details open>`). Jede Datei hat zusätzlich einen Download-Link (`download`-Attribut). Liste mit Name, Größe (`formatBytes`) und Art.

- [ ] **Step 1: Failing tests**

```tsx
test('kinds by extension and size', …'a.PNG' image, 'notes.md' markdown, 'log.txt' 262144 text, 262145 download, url, not_loaded);
test('images preview and enlarge', …<img src=attachmentUrl>, Klick → role=dialog, Esc schließt);
test('svg stays an img', …kein object/iframe/embed);
test('text previews with highlighting', …fetch → 'text/plain' → CodeBlock mit json);
test('binary under the limit is a download', …fetch → 'application/octet-stream' → nur Download-Link);
test('markdown attachments render', …);
test('url attachments show their host', …);
test('lfs pointers show the pull hint', …'git -C /wc lfs pull');
```

- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Install** `pnpm dlx shadcn@4.23.1 add dialog`; implementieren.
- [ ] **Step 4: Run** `pnpm vitest run --project web` → PASS; `mise run check` und `mise run smoke` grün; `pnpm build` hält das Chunk-Budget.
- [ ] **Step 5: Sichtprüfung** — `backe ui` gegen ein Test-Backlog im Browser (Playwright-MCP): Issue mit Tabellen, Code, `:tada:`, Mermaid, Bild- und Text-Anhang, Kommentar und Transition; Live-Update nach `backe comment add` im Terminal; Theme hell/dunkel samt Mermaid. Screenshot an den User.
- [ ] **Step 6: Docs** — ui.md Status-Satz: »Tab Issue lesend (§2.9 ohne §2.9.5, ohne Bearbeiten, Aktionen, Hochladen und Entfernen, ohne den lokalen Repo-Pfad)«; ROADMAP »Tab Issue lesend« abhaken; Gesamtplan U7 »Inhalt«: »lokaler Repo-Pfad über `repo_locate` (§2.9.1)« ergänzen — `repo_locate` ist ein Tool und verlangt Schreibrecht (ui.md §2.3.2), passt also zu `callTool`.
- [ ] **Step 7: Commit** — `feat: Anhänge im Issue-Tab mit Vorschau, Tab Issue lesend fertig`

## Festlegungen

| Stelle | Festlegung |
| --- | --- |
| Datenquelle des Tabs | Frontmatter und Beziehungen aus dem Store (live, ohne Request), Body und Zeitleiste aus `/issues/<id>`, Anhänge aus `/issues/<id>/attachments`. Präzisierung in ui.md §2.9 (Task 1). |
| Anhangsgröße und LFS | Neuer Lese-Endpunkt mit dem JSON von `attach list`; `not_loaded` kommt in BK dazu, damit CLI und UI dieselbe Antwort haben. |
| Lokaler Repo-Pfad | Wandert nach U7: `repo_locate` ist ein Tool und braucht eine schreibende Identität. |
| Highlighting ohne Farbe | ui.md §2.13 lässt Farbe nur für Fehler und Fokus zu; Tokens unterscheiden sich über Gewicht, Kursiv und Graustufe. |
| Markdown als Lazy-Chunk | `<Markdown>` lädt über `React.lazy`, damit `rehype-raw` (parse5) nicht im initialen Chunk landet; Fallback zeigt den Quelltext. |
