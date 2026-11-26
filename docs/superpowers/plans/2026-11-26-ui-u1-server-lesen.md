# backe ui U1 — Server-Gerüst und Lesen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `backe ui` startet einen lokalen HTTP-Server auf `127.0.0.1`, schützt ihn per Sitzungs-Token, Host- und Origin-Prüfung, liefert die lesende API (`/api/backlogs`, `/state`, Issue, Anhang, Suche) und die statischen Dateien aus `dist/ui/` mit SPA-Fallback und Platzhalter aus, und endet sauber bei SIGINT/SIGTERM.

**Architecture:** Neue Adapter-Schicht `src/ui/` auf `node:http`, abhängig nur von `src/tools/`, `services/` und darunter. Ein Request durchläuft fest: Host-Prüfung → Origin-Prüfung → Token-Tausch → Cookie-Prüfung → Route (`/api/…` oder statisch). Kontext je Anfrage über `uiContext` (Start-Eingaben für den Start-Backlog, sonst `-B <b>` plus `--as`). Antworten bauen dieselben Ansichten aus `services/views.ts` wie CLI und MCP. Der Befehl `src/cli/commands/ui.ts` löst den Start-Backlog auf, startet den Server, schreibt die Start-Zeile, öffnet optional den Browser und wartet auf ein Signal.

**Tech Stack:** unverändert (Node 26, TypeScript strict, Vitest, Biome, tsdown). Keine neue Abhängigkeit, auch keine `devDependency`.

**Spec:** `docs/proposals/ui.md` §2.1, §2.3.1 (ohne `events`), §2.3.3, §2.15 (ohne Uploads), §2.16 »Server«; dazu `docs/proposals/backe.md` §2.14 (Kontext), §2.18 (Sprache, Fehler-JSON), §2.20 (Schichten). Gesamtplan `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (Global Constraints, Festlegungen »Kontext je Backlog«, »`GET /api/backlogs`«, »Sprache«, »Port belegt«, »`--open`«, »Statisches Verzeichnis«). ui.md ist `spezifiziert`.

## Global Constraints

Alle Global Constraints des Gesamtplans. Dazu für U1:

- `src/ui/**` gehört zu `QUIET_LAYERS` in `test/conventions.test.ts`; die Start-Zeile schreibt allein `src/cli/commands/ui.ts`.
- Coverage-Gate `'src/ui/**': { lines: 90, branches: 85 }` in `vitest.config.ts`. Server-Tests laufen in-process gegen `createUiServer` auf Port 0.
- Jeder nutzersichtbare Text des Servers steht in einer `*.messages.ts` neben seiner Quelldatei, en + de (Konvention aus `src/i18n/catalog.ts`). Nicht übersetzt werden: die Start-Zeile `backe ui: http://127.0.0.1:<port>/?token=<token>`, Hinweise, die Befehle nennen (`backe ui --port <n>`), JSON-Keys und Fehlercodes.
- Tests schicken HTTP über `node:http` (`test/helpers/ui.ts`), nicht über `fetch`: `fetch` folgt Redirects, verwaltet keine Cookies wie ein Browser und lässt `Host` nicht frei setzen.
- Bestehende Golden-Files (`test/mcp/golden/`, `test/e2e/golden/`) bleiben byte-gleich.
- `rev` in `/state` ist in U1 konstant `0`; U2 ersetzt ihn durch den Zähler von `LiveBacklog`.
- Das Sitzungs-Cookie heißt `backe_ui_<port>` (`cookieName(port)` in `src/ui/security.ts`), etwa `backe_ui_8002`, nie `backe_ui`: Cookies trennen keine Ports, und ein fester Name ließe zwei Instanzen sich die Sitzung verdrängen (ui.md §2.15).

## Review Focus

1. **Fremde Webseite im selben Browser** — `POST` mit `Content-Type: text/plain` und fremdem oder fehlendem `Origin`, `Host: evil.example:<port>` nach DNS-Rebinding, gültiges Token nur im `Referer`. Erwartet: 403 bzw. 401, keine Daten im Body. → Task 2 `rejects foreign host and origin`, `a token in the referer opens no session`.
2. **Pfade aus der URL** — `/%2e%2e/secret`, `/..%2fsecret`, `%00`, ein Symlink aus `dist/ui/` hinaus, ein Anhangsname `../../.backe/backlog.jsonc`. Erwartet: 404, nie Bytes außerhalb von `dist/ui/` bzw. außerhalb der Anhänge. → Task 3 `static paths never leave the root`, Task 6 `attachment names never become paths`.
3. **Kaputter oder fehlender Stand** — Identität mit Key, aber ohne eigene Arbeitskopie; registrierter Backlog ganz ohne Arbeitskopie; ungültige `.backe/backlog.jsonc`; kaputtes Frontmatter. Erwartet: `/state` mit `sync: null` bzw. 404 mit Clone-Hinweis bzw. 400 nach §2.3.3 bzw. Eintrag in `problems`; der Server läuft weiter. → Task 5 `state of a backlog without own working copy`, `a backlog without any working copy is 404 with a clone hint`, `a broken backlog config is an error, the server keeps serving`, `a broken hand edit shows up in problems`.
4. **Aktive Inhalte als Anhang** — `page.html` mit gültigem UTF-8, SVG mit Skript, große Textdatei, ungültiges UTF-8. Erwartet: HTML nie inline, SVG nur mit `Content-Security-Policy: sandbox`, Text über 262 144 Bytes als Download. → Task 6 `html attachments are never inline`, `attachment bytes come with sandbox headers`.
5. **Start außerhalb der Registry** — `backe ui` in einer gebundenen Arbeitskopie, deren Backlog in dieser `BACKE_HOME` nicht registriert ist; `-B` auf einen unbekannten Namen. Erwartet: Erstere ist Start-Backlog und steht in `/api/backlogs`, ihr `/state` kommt aus genau dieser Arbeitskopie; Letzteres ist ein Startfehler wie im CLI (Exit 3). → Task 4 `a bound working copy outside the registry is the start backlog`, `an unregistered backlog flag fails the start`.

---

### Task 1: Schicht `src/ui/`, API-Typen und Fehler-Mapping

**Files:**
- Create: `src/ui/api.ts`, `src/ui/http.ts`, `src/ui/http.test.ts`
- Modify: `test/conventions.test.ts` (`QUIET_LAYERS`, neuer Schichtentest), `test/helpers/web-closure.ts` (`WEB_ENTRIES`), `vitest.config.ts` (Gate)

**Interfaces:**
- Produces (`src/ui/api.ts`, nur Typen; Imports ausschließlich `import type` aus `src/core/schemas.ts`):

```ts
export type BacklogEntryJson = { name: string; current: boolean; can_write: boolean; user: string | null };
export type BacklogsJson = { backlogs: BacklogEntryJson[]; lang: 'en' | 'de' };
export type IssueJson = Issue;
export type ProjectJson = { path: string } & Project;
export type SprintJson = { slug: string } & Sprint;
export type RepoJson = { name: string } & Repo;
/** Wie `user show --json` ohne `body`; leere Listen fehlen. */
export type UserJson = {
  handle: string; name: string; kind: 'human' | 'agent'; operator?: string; admin: boolean;
  fingerprints?: string[]; revoked?: { fingerprint: string; revoked: string }[];
};
export type ProblemJson = { path: string; message: string; kind?: EntityKind; key?: string };
export type StateJson = {
  rev: number; head: string; context: Record<string, unknown>;
  config: Omit<BacklogConfig, '$schema'>;
  issues: IssueJson[]; projects: ProjectJson[]; sprints: SprintJson[]; repos: RepoJson[];
  users: UserJson[]; problems: ProblemJson[];
  /** JSON von `sync status`; `null` ohne eigene Arbeitskopie. */
  sync: Record<string, unknown> | null;
};
export type ErrorJson = { error: { code: string; message: string; hint?: string; details?: unknown } };
```

- Produces (`src/ui/http.ts`):

```ts
export const JSON_TYPE = 'application/json; charset=utf-8';
/** Exit-Code → Status: 2 → 400, 3 → 404, 4 → 409, 5 → 422, 6 → 502, 1 → 500; Fremdfehler 500. */
export function httpStatus(err: unknown): number;
/** Kompaktes JSON ohne Zeilenende, `Content-Length`, `Cache-Control: no-store`. */
export function sendJson(res: ServerResponse, status: number, body: unknown, headers?: OutgoingHttpHeaders): void;
/** `errorJson(err)` mit `httpStatus(err)`. */
export function sendError(res: ServerResponse, err: unknown): void;
```

- [ ] **Step 1: Failing tests**

In `src/ui/http.test.ts`:

```ts
test.each([
  ['usage', 400], ['validation', 400], ['ambiguous', 400], ['not_found', 404],
  ['conflict', 409], ['verify', 422], ['sync', 502], ['unexpected', 500],
] as const)('httpStatus maps %s to %i', (code, status) => {
  expect(httpStatus(new BackeError(code, 'x'))).toBe(status);
});
test('httpStatus treats foreign errors as 500', () => expect(httpStatus(new Error('x'))).toBe(500));
test('sendError writes the error json of the cli', () => {
  // Fake-ServerResponse: Status 404, Body = JSON.stringify(errorJson(err)), Content-Type JSON_TYPE.
});
```

In `test/conventions.test.ts`:

```ts
test('adapters import each other only through the ui command', async () => {
  // Jeder Import (auch `import type`) wird relativ zur Datei aufgelöst.
  // src/ui/**  → nichts aus src/cli/ oder src/mcp/
  // src/mcp/** → nichts aus src/ui/ oder src/cli/
  // src/cli/** → aus src/ui/ nur in src/cli/commands/ui.ts
  expect(hits).toEqual([]);
});
```

- [ ] **Step 2: Tests laufen lassen**

Run: `pnpm vitest run src/ui/http.test.ts test/conventions.test.ts`
Expected: FAIL, `src/ui/http.ts` fehlt; der Schichtentest ist schon grün (es gibt noch kein `src/ui/`) — er sichert ab Task 2.

- [ ] **Step 3: `api.ts` und `http.ts` anlegen**; `'ui'` an `QUIET_LAYERS` anhängen, `'src/ui/api.ts'` an `WEB_ENTRIES`, `'src/ui/**': { lines: 90, branches: 85 }` ins Gate.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm vitest run src/ui test/conventions.test.ts`
Expected: PASS, auch `the web closure imports nothing from node` mit `src/ui/api.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/ui test/conventions.test.ts test/helpers/web-closure.ts vitest.config.ts
git commit -m "feat: Schicht src/ui mit API-Typen und Fehler-Mapping"
```

---

### Task 2: Server-Gerüst und Sitzung

**Files:**
- Create: `src/ui/security.ts`, `src/ui/security.messages.ts`, `src/ui/security.test.ts`, `src/ui/server.ts`, `src/ui/server.messages.ts`, `src/ui/server.test.ts`, `src/ui/pages.ts`, `src/ui/pages.messages.ts`, `test/helpers/ui.ts`

**Interfaces:**
- Consumes: `sendJson`, `sendError`, `JSON_TYPE` (Task 1).
- Produces (`src/ui/security.ts`):

```ts
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
/** Name des Sitzungs-Cookies: `backe_ui_<port>`, z. B. `backe_ui_8002`. */
export function cookieName(port: number): string;
/** 32 Bytes aus `randomBytes`, hex (64 Zeichen). */
export function newToken(): string;
/** `timingSafeEqual`; ungleiche Länge oder `undefined` → false. */
export function sameToken(given: string | undefined, token: string): boolean;
/** Werte aller Cookies `name` in Header-Reihenfolge; ein untergeschobenes gleichnamiges kann davor stehen. */
export function cookiesOf(header: string | undefined, name: string): string[];
export type Gate = { port: number; token: string; origins: readonly string[] };
export function ownOrigins(port: number): string[]; // http://127.0.0.1:<port>, http://localhost:<port>
export type Verdict =
  | { kind: 'pass' }
  | { kind: 'session'; location: string; cookie: string }
  | { kind: 'deny'; status: 401 | 403; code: 'unauthorized' | 'forbidden'; message: string; hint?: string };
export function checkRequest(req: { method: string; url: URL; headers: IncomingHttpHeaders }, gate: Gate): Verdict;
/** Für jede Antwort außer Anhängen: CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. */
export function appHeaders(): OutgoingHttpHeaders;
```

`checkRequest` prüft in dieser Reihenfolge: (1) `Host` ist `127.0.0.1:<port>` oder `localhost:<port>`, sonst 403; (2) ein vorhandener `Origin` steht in `gate.origins`, sonst 403; jede Methode außer GET/HEAD ohne `Origin` → 403; (3) Query-Parameter `token`: passt er, `session` mit `location` = Pfad plus übrige Query (ohne `token`) und `cookie` = `${cookieName(port)}=<token>; HttpOnly; SameSite=Strict; Path=/`; passt er nicht, 401; (4) eines der Cookies `backe_ui_<port>` passt, sonst 401 mit Hinweis auf die Konsolen-URL. `Referer` spielt keine Rolle.

- Produces (`src/ui/server.ts`):

```ts
export type UiOptions = {
  cwd: string;
  env: Env;
  flags: { backlog?: string; as?: string };
  /** Start-Backlog aus `resolveStart` (Task 4); `undefined` = keiner. */
  start: string | undefined;
  port: number;
  /** Default `fileURLToPath(new URL('./ui/', import.meta.url))`, im Bundle neben `dist/cli.js`. */
  staticDir?: string;
  /** Default `newToken()`; Tests setzen es fest. */
  token?: string;
};
export type UiServer = {
  /** Bindet `127.0.0.1`; `EADDRINUSE` → `BackeError('sync', …)`, Hint `backe ui --port <n>`. */
  listen(): Promise<{ port: number; url: string }>;
  /** Nimmt nichts Neues an, wartet laufende Handler ab, schließt dann alle Verbindungen. Idempotent. */
  close(): Promise<void>;
};
export function createUiServer(opts: UiOptions): UiServer;
```

`url` = `http://127.0.0.1:<port>/?token=<token>`. Antworten: `session` → 303 mit `Location` und `Set-Cookie`; `deny` → unter `/api/` `ErrorJson` mit `code` `unauthorized`/`forbidden`, sonst `page(…)` als HTML; unter `/api/` bis Task 4 404 `not_found` (`m.noEndpoint(path)`), sonst die Platzhalterseite (Task 3 ersetzt das). Ein unerwarteter Fehler im Handler → `sendError` (500), nie ein Absturz. Texte en/de: `portInUse(port)` = `Port ${port} is in use` / `Port ${port} ist belegt`.

- Produces (`src/ui/pages.ts`): `page(title: string, text: string): string` — kleines HTML-Dokument ohne Skript, Stil inline; `placeholderPage()` (»backe ui läuft; das Frontend ist nicht gebaut (`pnpm build`)«), `noSessionPage()`.

- Produces (`test/helpers/ui.ts`):

```ts
export type Res = { status: number; headers: IncomingHttpHeaders; body: Buffer; text(): string; json(): any };
/** `node:http`-Request; `Host` ist `127.0.0.1:<port>`, solange `headers.host` nichts anderes sagt. */
export function rawRequest(port: number, req: { method?: string; path: string; headers?: OutgoingHttpHeaders; body?: string | Uint8Array }): Promise<Res>;
export type UiHarness = { port: number; token: string; cookie: string; get(path: string, headers?: OutgoingHttpHeaders): Promise<Res>; close(): Promise<void> };
/** Startet `createUiServer` auf Port 0, tauscht das Token und hält das Cookie; `close` nach jedem Test. */
export function startUi(opts: Omit<UiOptions, 'port'>): Promise<UiHarness>;
```

- [ ] **Step 1: Failing tests**

`src/ui/security.test.ts`: `newToken` liefert 64 Hex-Zeichen und zweimal verschiedene Werte; `sameToken` mit `undefined`, kürzerem und gleichem Wert; `cookieName(8002) === 'backe_ui_8002'`; `cookiesOf('a=1; backe_ui_8002=x; b=2', 'backe_ui_8002')` ist `['x']`, `cookiesOf(undefined, …)` ist `[]`; `checkRequest`-Tabelle über die vier Stufen.

`src/ui/server.test.ts` (gegen `startUi` bzw. `rawRequest`):

```ts
test('the token sets the session cookie and redirects without it', async () => {
  const r = await rawRequest(ui.port, { path: `/b/acme?token=${ui.token}&x=1` });
  expect(r.status).toBe(303);
  expect(r.headers.location).toBe('/b/acme?x=1');
  expect(r.headers['set-cookie']).toEqual([`backe_ui_${ui.port}=${ui.token}; HttpOnly; SameSite=Strict; Path=/`]);
});
test('requests without the cookie get 401', async () => {
  const api = await rawRequest(ui.port, { path: '/api/backlogs' });
  expect(api.status).toBe(401);
  expect(api.json().error.code).toBe('unauthorized');
  expect(api.json().error.hint).toBeDefined();
  const html = await rawRequest(ui.port, { path: '/' });
  expect([html.status, html.headers['content-type']]).toEqual([401, 'text/html; charset=utf-8']);
});
test('a wrong token gets 401 and no cookie', async () => { /* ?token=<64 andere Hex-Zeichen> */ });
test('rejects foreign host and origin', async () => {
  const cookie = { cookie: ui.cookie };
  expect((await ui.get('/api/backlogs', { host: `evil.example:${ui.port}` })).status).toBe(403);
  expect((await ui.get('/api/backlogs', { host: `localhost:${ui.port}` })).status).not.toBe(403);
  expect((await ui.get('/api/backlogs', { origin: 'http://evil.example' })).status).toBe(403);
  const post = await rawRequest(ui.port, {
    method: 'POST', path: '/api/b/acme/tools/issue_create',
    headers: { ...cookie, 'content-type': 'text/plain' }, body: '{"title":"x"}',
  });
  expect(post.status).toBe(403);
  expect(post.json().error.code).toBe('forbidden');
});
test('a token in the referer opens no session', async () => {
  const r = await rawRequest(ui.port, { path: '/api/backlogs', headers: { referer: `http://127.0.0.1:${ui.port}/?token=${ui.token}` } });
  expect(r.status).toBe(401);
});
test('every response carries the security headers', async () => {
  // 200 (/), 303, 401, 403, 404 (/api/nope): content-security-policy === CSP,
  // x-content-type-options === 'nosniff', referrer-policy === 'no-referrer'.
});
test('a busy port is a sync error', async () => {
  const err = await catchErrAsync(() => createUiServer({ ...opts, port: ui.port }).listen());
  expect([err.code, err.exitCode, err.hint]).toEqual(['sync', 6, 'backe ui --port <n>']);
});
test('listens on 127.0.0.1 only', async () => {
  // net.connect({ host: '::1', port: ui.port }) scheitert (ECONNREFUSED oder EADDRNOTAVAIL).
});
test('close ends open connections', async () => {
  // Keep-Alive-Agent mit offener Verbindung; close() löst auf; danach ECONNREFUSED.
});
```

- [ ] **Step 2: Tests laufen lassen**

Run: `pnpm vitest run src/ui`
Expected: FAIL, `security.ts`/`server.ts` fehlen.

- [ ] **Step 3: `security.ts`, `pages.ts`, `server.ts` samt Messages implementieren, `test/helpers/ui.ts` anlegen**

Der Server hält laufende Handler in einer Menge von Promises; `close` ruft `server.close()`, wartet diese ab und dann `server.closeAllConnections()`. `req.url` wird mit `new URL(req.url, 'http://127.0.0.1')` gelesen.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm vitest run src/ui test/conventions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui test/helpers/ui.ts
git commit -m "feat: Server-Gerüst von backe ui mit Sitzung und Sicherheits-Headern"
```

---

### Task 3: Statische Auslieferung

**Files:**
- Create: `src/ui/static.ts`, `src/ui/static.test.ts`
- Modify: `src/ui/server.ts` (Nicht-API-Pfade → `serveStatic`)

**Interfaces:**
- Consumes: `appHeaders` (Task 2), `placeholderPage` (Task 2).
- Produces: `export function serveStatic(req: IncomingMessage, url: URL, res: ServerResponse, dir: string): Promise<void>;`

Festlegungen: Nur GET/HEAD, sonst 404. Der Pfad wird segmentweise per `decodeURIComponent` gelesen; ungültige Kodierung, ein NUL oder ein Segment `..` → 404. Der `realpath` des Ziels muss unter dem `realpath` von `dir` liegen, sonst 404. Datei vorhanden → 200, `Content-Length`, Typ nach Endung (`.html` `text/html; charset=utf-8`, `.js` `text/javascript; charset=utf-8`, `.css` `text/css; charset=utf-8`, `.json`/`.map` `application/json`, `.svg` `image/svg+xml`, `.png` `image/png`, `.ico` `image/x-icon`, `.woff2` `font/woff2`, `.txt` `text/plain; charset=utf-8`, sonst `application/octet-stream`); `Cache-Control: public, max-age=31536000, immutable` unter `/assets/`, sonst `no-cache`. Fehlt die Datei und hat das letzte Segment keinen Punkt (App-Route) → `index.html` mit `no-cache`, ohne `index.html` die Platzhalterseite (200). Fehlt sie mit Punkt → 404 `text/plain`.

- [ ] **Step 1: Failing tests in `src/ui/static.test.ts`** (Temp-Verzeichnis mit `index.html`, `assets/app-3f9a1c.js`, `favicon.ico`; Server über `startUi({…, staticDir})`)

```ts
test('serves hashed assets as immutable', async () => {
  const r = await ui.get('/assets/app-3f9a1c.js');
  expect([r.status, r.headers['content-type'], r.headers['cache-control']])
    .toEqual([200, 'text/javascript; charset=utf-8', 'public, max-age=31536000, immutable']);
});
test('app routes fall back to index.html', async () => {
  const r = await ui.get('/b/acme/issues/bk-1');
  expect([r.status, r.text(), r.headers['cache-control']]).toEqual([200, INDEX, 'no-cache']);
});
test('missing files with an extension are 404', async () => expect((await ui.get('/nope.js')).status).toBe(404));
test('static paths never leave the root', async () => {
  // secret.txt liegt neben dir; assets/out ist ein Symlink auf dirname(dir).
  for (const p of ['/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/%00x', '/assets/out/secret.txt', '/%E0%A4%A']) {
    const r = await ui.get(p);
    expect(r.status, p).toBe(404);
    expect(r.text(), p).not.toContain(SECRET);
  }
});
test('without a build the placeholder answers app routes', async () => { /* leeres dir → 200 HTML mit »backe ui« */ });
test('head answers with headers only', async () => { /* HEAD /assets/… → 200, content-length gesetzt, leerer Body */ });
```

- [ ] **Step 2: Tests laufen lassen** — Run: `pnpm vitest run src/ui/static.test.ts` — Expected: FAIL, `static.ts` fehlt.

- [ ] **Step 3: `serveStatic` implementieren und im Server einhängen** (Stream per `createReadStream`, Header aus `appHeaders()`).

- [ ] **Step 4: Tests laufen lassen** — Run: `pnpm vitest run src/ui` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui
git commit -m "feat: backe ui liefert dist/ui mit SPA-Fallback und Platzhalter aus"
```

---

### Task 4: Routen, Kontext je Backlog und `GET /api/backlogs`

**Files:**
- Create: `src/ui/routes.ts`, `src/ui/routes.test.ts`, `src/ui/context.ts`, `src/ui/context.test.ts`, `src/ui/read-api.ts`, `src/ui/read-api.messages.ts`, `src/ui/read-api.test.ts`
- Modify: `src/ui/server.ts` (`/api/…` → `readRoute` → `handleRead`, sonst 404 `not_found`)

**Interfaces:**
- Consumes: `resolveContext`, `requireWriter`, `type ResolvedContext` (`src/context/resolve.ts`); `listBacklogs` (`src/context/registry.ts`); `readUserConfig` (`src/context/user-config.ts`); `resolveHomes` (`src/context/paths.ts`); `locale` (`src/i18n/locale.ts`); `compareCodeUnits` (`src/core/compare.ts`); `BACKLOG_NAME_RE` (`src/core/names.ts`).
- Produces (`src/ui/routes.ts`):

```ts
export type ReadRoute =
  | { kind: 'backlogs' }
  | { kind: 'state'; backlog: string }
  | { kind: 'issue'; backlog: string; id: string }
  | { kind: 'attachment'; backlog: string; id: string; name: string }
  | { kind: 'search'; backlog: string; q: string | undefined };
/** GET/HEAD auf `/api/backlogs` und `/api/b/<b>/…`; Segmente percent-dekodiert; `<b>` muss `BACKLOG_NAME_RE` erfüllen. Sonst `undefined`. */
export function readRoute(method: string, url: URL): ReadRoute | undefined;
```

- Produces (`src/ui/context.ts`):

```ts
export type StartInput = { cwd: string; env: Env; flags: { backlog?: string; as?: string } };
/**
 * Name des Start-Backlogs aus den Start-Eingaben (BK §2.14). Wirft `resolveContext` `usage` (kein
 * Backlog angegeben) und ist mindestens ein Backlog registriert, `undefined`. Jeder andere Fehler —
 * und `usage` ohne registrierten Backlog — geht unverändert weiter (Startfehler wie im CLI).
 */
export function resolveStart(input: StartInput): Promise<string | undefined>;
/**
 * Kontext einer Anfrage: Für `start` die Start-Eingaben unverändert (so gilt eine gebundene
 * Arbeitskopie im Startverzeichnis); löst das inzwischen einen anderen Namen auf, oder ist `backlog`
 * ein anderer, `{ backlog, as: input.flags.as }`.
 */
export function uiContext(input: StartInput, start: string | undefined, backlog: string): Promise<ResolvedContext>;
/**
 * Registrierte Backlogs plus `start`, nach Name sortiert. `current` = Start-Backlog; `can_write` =
 * `requireWriter` gelingt; `user` = aufgelöster Handle oder `null`. Scheitert der Kontext eines
 * Backlogs, steht er mit `can_write: false`, `user: null` in der Liste. `lang` = `locale()`.
 */
export function backlogsJson(input: StartInput, start: string | undefined): Promise<BacklogsJson>;
```

- Produces (`src/ui/read-api.ts`): `export type ReadEnv = { input: StartInput; start: string | undefined };` `export function handleRead(route: ReadRoute, env: ReadEnv, res: ServerResponse): Promise<void>;` — in diesem Task nur `backlogs`; die übrigen Arten antworten bis Task 5/6 mit 404 `not_found`. Fehler gehen über `sendError`.

- [ ] **Step 1: Failing tests**

`src/ui/routes.test.ts`: Tabelle — `/api/backlogs` → `backlogs`; `/api/b/acme/state`; `/api/b/acme/issues/bk-12`; `/api/b/acme/issues/bk-12/attachments/a%20b.png` → `name: 'a b.png'`; `/api/b/acme/search?q=x`; `undefined` für `POST`, `/api/b/ACME/state`, `/api/b/acme/events`, `/api/b/acme/issues/bk-1/attachments/%E0`, `/api/b/acme/state/x`.

`src/ui/context.test.ts` (mit `testBacklog`):

```ts
test('the start backlog falls back to none when nothing names one', async () => {
  // registriert, `current` entfernt, cwd außerhalb jeder Arbeitskopie → undefined
});
test('no registered backlog keeps the cli error', async () => {
  const err = await catchErrAsync(() => resolveStart({ cwd: emptyDir, env: freshEnv, flags: {} }));
  expect([err.code, err.exitCode]).toEqual(['usage', 2]);
});
test('an unregistered backlog flag fails the start', async () => {
  const err = await catchErrAsync(() => resolveStart({ ...input, flags: { backlog: 'nope' } }));
  expect([err.code, err.exitCode]).toEqual(['not_found', 3]);
});
test('a bound working copy outside the registry is the start backlog', async () => {
  // `git clone` der Arbeitskopie in ein Temp-Verzeichnis, frisches BACKE_HOME ohne Registry,
  // cwd = Klon: resolveStart → 'acme'; backlogsJson listet acme mit current: true;
  // uiContext(input, 'acme', 'acme').backlog.root === Klon.
});
test('backlogs reports can_write per identity', async () => {
  // as: 'spw' (Key eingetragen) → { name: 'acme', current: true, can_write: true, user: 'spw' };
  // as: 'reader' (kein Key) → can_write: false, user: 'reader'; lang === 'de' (Testlauf-Locale).
});
```

`src/ui/read-api.test.ts`: `GET /api/backlogs` über `startUi` → 200, `content-type` `application/json; charset=utf-8`, Body gleich `backlogsJson(input, 'acme')`; `/api/b/acme/nope` → 404 mit `error.code` `not_found`.

- [ ] **Step 2: Tests laufen lassen** — Run: `pnpm vitest run src/ui` — Expected: FAIL, Module fehlen.

- [ ] **Step 3: `routes.ts`, `context.ts`, `read-api.ts` implementieren, Server verdrahten**

- [ ] **Step 4: Tests laufen lassen** — Run: `pnpm vitest run src/ui test/conventions.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui
git commit -m "feat: Kontext je Backlog und GET /api/backlogs in backe ui"
```

---

### Task 5: `GET /api/b/<b>/state`

**Files:**
- Create: `src/ui/state.ts`, `src/ui/state.test.ts`
- Modify: `src/ui/read-api.ts` (Route `state`)

**Interfaces:**
- Consumes: `uiContext` (Task 4); `openSnapshot` (`src/services/read.ts`); `contextInfo` (`src/services/context-info.ts`); `contextJson`, `syncStatusJson` (`src/services/views.ts`); `syncStatus` (`src/services/background.ts`); `resolveCommit` (`src/git/history.ts`); `sshFingerprint` (`src/core/fingerprint.ts`); `exists` (`src/store/files.ts`); `BACKLOG_CONFIG` (`src/store/layout.ts`).
- Produces:

```ts
export function stateJson(ctx: ResolvedContext): Promise<StateJson>;
export function userJson(handle: string, user: User, admins: readonly string[]): UserJson;
```

Festlegungen: `rev: 0`; `head` = `resolveCommit(root, 'HEAD')`; `context` = `contextJson(await contextInfo(ctx))`; `config` = `snapshot.config` ohne `$schema`; `issues` = `data` jedes Issues in Snapshot-Reihenfolge (ohne `body`, ohne unbekannte Keys — wie die Einträge von `issue list --json` ohne `depth`/`open_deps`); `projects` `{path, ...data}`, `sprints` `{slug, ...data}`, `repos` `{name, ...data}`, `users` über `userJson` (Fingerprints statt Keys, wie `user show --json` ohne `body`); `problems` = `snapshot.problems`; alle Listen immer vorhanden. `sync` = `syncStatusJson(await syncStatus(ctx))`, wenn die eigene Arbeitskopie (`ctx.backlog.workingCopy`) existiert und `BACKLOG_CONFIG` enthält, sonst `null`. Ohne jede Arbeitskopie wirft `openSnapshot` `not_found` samt Clone-Hinweis.

- [ ] **Step 1: Failing tests in `src/ui/state.test.ts`**

```ts
test('state has the keys of the spec', async () => {
  expect(Object.keys(await stateJson(ctx))).toEqual([
    'rev', 'head', 'context', 'config', 'issues', 'projects', 'sprints', 'repos', 'users', 'problems', 'sync',
  ]);
});
test('issues carry frontmatter without body', async () => {
  // Issue mit Body anlegen; state.issues[0] hat keinen Key `body` und ist gleich
  // dem Eintrag aus listIssues(ctx, {states: ['all']}) ohne depth/open_deps.
});
test('users carry fingerprints, never keys', async () => {
  const s = await stateJson(ctx);
  expect(JSON.stringify(s)).not.toContain(b.key.line.split(' ')[1]);
  expect(s.users[0]?.fingerprints?.[0]).toMatch(/^SHA256:/);
});
test('head is the commit of the working copy', async () => { /* gleich revParse(b.root, 'HEAD') */ });
test('state of a backlog without own working copy', async () => {
  // Identität claude-1 mit Key (setIdentity), keine eigene Arbeitskopie; GET /api/b/acme/state
  // über startUi mit flags.as = 'claude-1' → 200, issues gefüllt, sync === null.
});
test('a backlog without any working copy is 404 with a clone hint', async () => {
  // registerBacklog(homes, { name: 'other', remote }) ohne Klon → 404, error.code 'not_found',
  // error.hint enthält 'backe backlog clone'.
});
test('a broken backlog config is an error, the server keeps serving', async () => {
  // `.backe/backlog.jsonc` im Arbeitsbaum mit `{` überschreiben → /state 400 mit error.code
  // 'validation'; danach /api/backlogs 200.
});
test('a broken hand edit shows up in problems', async () => {
  // Frontmatter einer Issue-Datei zerstören → 200, problems enthält { kind: 'issue', key: <id> }.
});
```

- [ ] **Step 2: Tests laufen lassen** — Run: `pnpm vitest run src/ui/state.test.ts` — Expected: FAIL, `state.ts` fehlt.

- [ ] **Step 3: `stateJson` und `userJson` implementieren, Route verdrahten**

- [ ] **Step 4: Tests laufen lassen** — Run: `pnpm vitest run src/ui` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui
git commit -m "feat: GET /state liefert den Gesamtzustand eines Backlogs"
```

---

### Task 6: Issue, Anhang und Suche

**Files:**
- Create: `src/ui/attachment.ts`, `src/ui/attachment.messages.ts`, `src/ui/attachment.test.ts`
- Modify: `src/ui/read-api.ts`, `src/ui/read-api.messages.ts`, `src/ui/read-api.test.ts`, `src/tools/read.ts` (Konstante exportieren)

**Interfaces:**
- Consumes: `showIssue` (`src/services/issue-show.ts`), `issueShowJson`, `issueListResultJson` (`src/services/views.ts`), `listIssues` (`src/services/issue-list.ts`), `getAttachment` (`src/services/attachments.ts`).
- Produces: `export const ATTACHMENT_TEXT_LIMIT = 262_144;` in `src/tools/read.ts` (bisher die private `TEXT_LIMIT`; `attachment_get` nutzt sie weiter). In `src/ui/attachment.ts`:

```ts
export type Delivery = { type: string; disposition: 'inline' | 'attachment' };
/** `bytes` = ganzer Inhalt, wenn die Datei höchstens `ATTACHMENT_TEXT_LIMIT` Bytes hat, sonst `undefined`. */
export function attachmentDelivery(name: string, bytes: Uint8Array | undefined): Delivery;
/** `inline|attachment; filename*=UTF-8''<encodeURIComponent(name)>` */
export function contentDisposition(d: Delivery['disposition'], name: string): string;
/** Länge und Inhalt aus dem `fstat` des einmal geöffneten Handles (`sendFile`), nie aus einer vorab ermittelten Größe. */
export function sendAttachment(res: ServerResponse, a: { name: string; path: string }, head: boolean): Promise<void>;
```

Festlegungen (ui.md §2.9.4, §2.15): Endung kleingeschrieben. `png` `image/png`, `jpg`/`jpeg` `image/jpeg`, `gif` `image/gif`, `webp` `image/webp`, `avif` `image/avif`, `svg` `image/svg+xml` → inline. `html`, `htm`, `xhtml`, `xht` → `application/octet-stream`, attachment. Sonst: `bytes` vorhanden und gültiges UTF-8 (`TextDecoder('utf-8', {fatal: true})`) → `text/plain; charset=utf-8`, inline; sonst `application/octet-stream`, attachment. Header jedes Anhangs: `Content-Type`, `Content-Disposition`, `Content-Length`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` (statt der App-CSP), `Referrer-Policy: no-referrer`, `Cache-Control: no-store`. Ein URL-Anhang → 404 `not_found` (`m.linkAttachment(id, name)`). Routen: `issue` → `issueShowJson(await showIssue(ctx, id, { comments: 'all' }))`; `search` ohne oder mit leerem `q` → `BackeError('usage', m.searchNeedsQuery, { hint: '?q=<text>' })`, sonst `issueListResultJson(await listIssues(ctx, { text: q, states: ['all'] }))`.

- [ ] **Step 1: Failing tests**

`src/ui/attachment.test.ts`:

```ts
test.each([
  ['shot.PNG', undefined, 'image/png', 'inline'],
  ['logo.svg', utf8('<svg/>'), 'image/svg+xml', 'inline'],
  ['notes.md', utf8('# x'), 'text/plain; charset=utf-8', 'inline'],
  ['data.json', utf8('{}'), 'text/plain; charset=utf-8', 'inline'],
  ['big.log', undefined, 'application/octet-stream', 'attachment'],
  ['blob.bin', new Uint8Array([0xff, 0xfe]), 'application/octet-stream', 'attachment'],
])('attachmentDelivery(%s)', (name, bytes, type, disposition) => {
  expect(attachmentDelivery(name, bytes)).toEqual({ type, disposition });
});
test('html attachments are never inline', () => {
  for (const name of ['page.html', 'PAGE.HTM', 'a.xhtml']) {
    expect(attachmentDelivery(name, utf8('<p>x</p>'))).toEqual({ type: 'application/octet-stream', disposition: 'attachment' });
  }
});
test('contentDisposition encodes the name', () => {
  expect(contentDisposition('inline', 'a b ä.png')).toBe("inline; filename*=UTF-8''a%20b%20%C3%A4.png");
});
```

`src/ui/read-api.test.ts` (über `startUi`, Anhänge per `addAttachment`):

```ts
test('issue matches issue show with all comments', async () => {
  // Issue mit Body und Kommentar; GET mit Kurz-ID → gleich issueShowJson(showIssue(ctx, id, {comments: 'all'})).
});
test('unknown issues are 404', async () => { /* error.code 'not_found' */ });
test('attachment bytes come with sandbox headers', async () => {
  const r = await ui.get(`/api/b/acme/issues/${id}/attachments/logo.svg`);
  expect(r.body.equals(SVG_BYTES)).toBe(true);
  expect(r.headers['content-security-policy']).toBe('sandbox');
  expect(r.headers['x-content-type-options']).toBe('nosniff');
  expect(r.headers['content-disposition']).toBe("inline; filename*=UTF-8''logo.svg");
});
test('attachment names never become paths', async () => {
  const r = await ui.get(`/api/b/acme/issues/${id}/attachments/..%2F..%2F.backe%2Fbacklog.jsonc`);
  expect(r.status).toBe(404);
  expect(r.text()).not.toContain('"id_prefix"');
});
test('a link attachment is 404', async () => { /* URL-Anhang → 404, error.code 'not_found' */ });
test('search finds body text in settled issues', async () => {
  // Issue im State done mit Wort nur im Body → in issues; Antwort gleich
  // issueListResultJson(listIssues(ctx, {text, states: ['all']})).
});
test('search without q is 400', async () => {
  expect((await ui.get('/api/b/acme/search')).json().error.code).toBe('usage');
});
```

- [ ] **Step 2: Tests laufen lassen** — Run: `pnpm vitest run src/ui` — Expected: FAIL, `attachment.ts` fehlt.

- [ ] **Step 3: `attachment.ts` implementieren, Routen `issue`, `attachment`, `search` in `read-api.ts`, Konstante in `src/tools/read.ts` exportieren**

Für `attachmentDelivery` liest `sendAttachment` die Datei nur, wenn ihre Größe laut `fstat` des geöffneten Handles `≤ ATTACHMENT_TEXT_LIMIT` ist, und schickt dann genau diese Bytes; bei HEAD liest sie sie ebenso, weil der Typ vom Inhalt abhängen kann. Größere Dateien gehen als Stream desselben Handles.

- [ ] **Step 4: Tests laufen lassen** — Run: `pnpm vitest run src/ui src/tools test/mcp` — Expected: PASS; `git status --short test/mcp/golden` leer.

- [ ] **Step 5: Commit**

```bash
git add src/ui src/tools/read.ts
git commit -m "feat: Issue, Anhänge und Suche über die lesende API von backe ui"
```

---

### Task 7: Befehl `backe ui`

**Files:**
- Create: `src/cli/commands/ui.ts`, `src/cli/commands/ui.messages.ts`, `test/e2e/ui.test.ts`
- Modify: `src/cli/run.ts` (`uiCommand(program, rt)` nach `mcpCommand`)

**Interfaces:**
- Consumes: `resolveStart` (Task 4), `createUiServer` (Task 2); `subcommand`, `action`, `globalOpts` (`src/cli/options.ts`); `renderHints` (`src/cli/output.ts`).
- Produces: `export function uiCommand(program: Command, rt: Runtime): void;`

Ablauf der Aktion (`action(rt, fn, { statusLine: () => false })`, die Locale bleibt die des Prozesses):
1. `--port` lesen: ganze Zahl 0–65535, Default `8002`; sonst `BackeError('validation', m.invalidPort(value), { hint: 'backe ui --port <n>' })`.
2. `input = { cwd, env, flags }` mit `-B`/`--as` aus `globalOpts(cmd)` (vor oder nach `ui`).
3. `start = await resolveStart(input)`; Fehler gehen an `run` (Exit-Code wie im CLI).
4. `createUiServer({ ...input, start, port }).listen()`; danach genau eine Zeile `backe ui: <url>\n` über `env.out`.
5. Mit `--open`: `xdg-open` (Linux) bzw. `open` (macOS) per `spawn(cmd, [url], { detached: true, stdio: 'ignore' })`, `unref()`. Ein `error`-Ereignis oder ein Exit-Code ≠ 0 schreibt `renderHints([m.openFailed(cmd)])` auf stderr; andere Plattformen schreiben den Hinweis sofort. Der Exit-Code bleibt davon unberührt.
6. Auf das erste `SIGINT` oder `SIGTERM` warten (`process.once`, beide Listener danach entfernen), `await server.close()`, Ende mit 0.

Texte en/de: `description` (»Start the local web interface« / »lokale Web-Oberfläche starten«), `portOption`, `openOption`, `invalidPort(value)`, `openFailed(cmd)` (»Could not open the browser with ${cmd}; open the URL above yourself« / »Browser ließ sich mit ${cmd} nicht öffnen; die URL oben selbst öffnen«).

- [ ] **Step 1: Failing E2E-Tests in `test/e2e/ui.test.ts`**

Lokaler Helfer `spawnUi(args, {env, cwd})`: startet `node dist/cli.js ui …`, liest stdout bis zur ersten Zeile und liefert `{ line, port, token, stderr(), stop(signal): Promise<number | null> }`.

```ts
const START = /^backe ui: http:\/\/127\.0\.0\.1:(\d+)\/\?token=([0-9a-f]{64})$/;

test('prints exactly one start line and serves the api', async () => {
  const ui = await spawnUi(['ui', '--port', '0'], { env, cwd: b.root });
  expect(ui.line).toMatch(START);
  // Token-Tausch per rawRequest, dann /api/backlogs → 200 mit acme
  expect(await ui.stop('SIGTERM')).toBe(0);
  expect(ui.stdout()).toBe(`${ui.line}\n`);
});
test('SIGINT ends with exit code 0', async () => { /* … */ });
test('a busy port exits with 6', async () => {
  // net.createServer().listen(0, '127.0.0.1'); cli(['ui', '--port', String(p)])
  // → code 6, stderr enthält `Port ${p}` und `backe ui --port <n>`.
});
test('the console speaks the server language', async () => {
  // wie oben mit BACKE_LANG=de → stderr enthält `Port ${p} ist belegt`.
});
test('without a registered backlog the start fails like the cli', async () => { /* frisches BACKE_HOME → code 2 */ });
test('an invalid port is a validation error', async () => { /* --port 70000 → code 2 */ });
test.runIf(process.platform === 'linux')('--open hands the url to xdg-open', async () => {
  // Temp-Verzeichnis mit ausführbarem `xdg-open`: `printf '%s' "$1" > "$OUT"`; PATH davor.
  // vi.waitFor: Inhalt von $OUT === URL aus der Start-Zeile.
});
test.runIf(process.platform === 'linux')('a failing browser start is only a hint', async () => {
  // Fake-`xdg-open` mit `exit 3`; vi.waitFor: stderr enthält den Hinweis; /api/backlogs
  // antwortet weiter; stop('SIGTERM') → 0.
});
test('api json equals the cli json', async () => {
  // Issue mit Body und Kommentar, ein zweites mit Suchwort im Body:
  // /api/b/acme/issues/<id> gleich JSON.parse(cli(['issue', 'show', id, '--comments', 'all', '--json']).stdout);
  // /api/b/acme/search?q=<wort> gleich JSON.parse(cli(['issue', 'list', '-q', wort, '--state', 'all', '--json']).stdout).
});
```

- [ ] **Step 2: Build und Tests laufen lassen**

Run: `pnpm build && pnpm vitest run test/e2e/ui.test.ts`
Expected: FAIL, `ui` ist ein unbekannter Befehl.

- [ ] **Step 3: `uiCommand` implementieren und in `buildProgram` registrieren**

- [ ] **Step 4: Build und Tests laufen lassen**

Run: `pnpm build && pnpm vitest run test/e2e/ui.test.ts test/i18n`
Expected: PASS, auch die Katalog-Prüfungen für die neuen Texte.

- [ ] **Step 5: Volle Prüfung und Commit**

Run: `mise run check && mise run smoke`
Expected: PASS inklusive Coverage-Gate `src/ui/**`; der Pack-Smoke-Test ist unverändert grün (`dist/ui/` gibt es erst ab U4).

```bash
git add src/cli/commands/ui.ts src/cli/commands/ui.messages.ts src/cli/run.ts test/e2e/ui.test.ts
git commit -m "feat: Befehl backe ui startet den lokalen Server"
```

---

### Task 8: Proposal und Roadmap nachziehen

**Files:**
- Modify: `docs/proposals/ui.md` (Statuskopf, §2.1, §2.3.1, §2.3.3, §2.15, §2.16), `ROADMAP.md`

Kein Test; Prüfung per Lesen und `grep`. Jede Änderung als Gegenwart, ohne »präzisiert« oder »bisher«.

- [ ] **Step 1: Statuskopf** — `in Umsetzung`; Status-Satz: »Gebaut: Befehl `backe ui`, Sitzung und Sicherheits-Header, lesende API ohne `events`, statische Auslieferung (§2.1 ohne das Warten der Write-Warteschlange, §2.3.1, §2.3.3, §2.15 ohne Uploads, §2.16 »Server«). Offen: alles ab §2.3.2 und §2.4.«
- [ ] **Step 2: §2.1** — Start-Backlog: Fehlt nur die Angabe eines Backlogs und ist mindestens einer registriert, startet die UI ohne Start-Backlog; ein genannter, unbekannter Backlog (`-B`, `BACKE_BACKLOG`, Projekt-Config) ist ein Startfehler wie im CLI. Eine gebundene Arbeitskopie im Startverzeichnis ist Start-Backlog, auch wenn ihr Backlog nicht registriert ist. `--port` nimmt 0–65535. `--open`: ein Startfehler oder ein Exit-Code ≠ 0 des Öffners ist ein Hinweis auf stderr.
- [ ] **Step 3: §2.3.1** — `/api/backlogs`: `{backlogs:[{name, current, can_write, user}], lang}`, `current` = Start-Backlog, `user` = Handle oder `null`, registrierte Backlogs plus Start-Backlog. `/state`: Listen immer vorhanden; Einträge `projects` `{path, …}`, `sprints` `{slug, …}`, `repos` `{name, …}`, `users` wie `user show --json` ohne `body`; `sync` ist `null` ohne eigene Arbeitskopie. `/search` ohne `q` → 400. Ein URL-Anhang hat keine Bytes → 404.
- [ ] **Step 4: §2.3.3** — 401 trägt `code: "unauthorized"`, 403 `code: "forbidden"`; ein unbekannter Endpunkt ist 404 `not_found`.
- [ ] **Step 5: §2.15** — Token als 64 Hex-Zeichen; der Tausch antwortet mit 303. Jede Antwort trägt `Referrer-Policy: no-referrer`. Ein vorhandener `Origin` muss bei jeder Anfrage der eigene sein; jede Anfrage außer GET/HEAD braucht ihn.
- [ ] **Step 6: §2.16 »Server«** — `Cache-Control: public, max-age=31536000, immutable` unter `/assets/`, sonst `no-cache`; Fallback auf `index.html` nur für Pfade, deren letztes Segment keinen Punkt hat; ohne `index.html` eine eingebaute Platzhalterseite.
- [ ] **Step 7: ROADMAP** — »Server-Gerüst (UI §6 Schritt 1)« abhaken.
- [ ] **Step 8: Prüfen** — Run: `grep -n "Status: spezifiziert" docs/proposals/ui.md` — Expected: kein Treffer.
- [ ] **Step 9: Commit**

```bash
git add docs/proposals/ui.md ROADMAP.md
git commit -m "docs: ui.md in Umsetzung, Präzisierungen aus dem Server-Gerüst"
```

Die Commit-Message nennt im Body jede Proposal-Änderung (Datei, Abschnitt, was), wie das Harness es verlangt.
