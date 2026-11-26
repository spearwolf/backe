# backe ui U3 — Server-Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `backe ui` schreibt: `POST /api/b/<b>/tools/<tool>` führt jedes Tool aus `toolsFor('ui')` aus — die MCP-Tools plus die Verwaltungs-Tools aus ui.md §2.3.2 —, `PUT /api/b/<b>/issues/<id>/attachments/<name>` lädt Anhänge hoch, beides über eine Warteschlange und einen Hintergrund-Sync je Backlog; das Ende des Servers wartet auf alles davon.

**Architecture:** Die neuen Tools kommen als Katalog-Einträge mit `surfaces: ['ui']` nach `src/tools/` (`admin.ts`), damit Name, Parameter und Ergebnis an einer Stelle stehen; MCP sieht sie nicht. In `src/ui/` kommen drei Bausteine dazu: `body.ts` liest Anfrage-Bodies mit Grenze und Content-Type-Prüfung, `tools.ts` hält je Backlog ein `ToolEnv` (Kontext mit `requireWriter`, Warteschlange, `pending`), `write-api.ts` bedient Tool-Aufrufe und Uploads. Den neuen Zustand bekommt der Client weiter über den Event-Stream aus U2; die Antwort trägt nur das Write-JSON.

**Tech Stack:** unverändert. Keine neue Abhängigkeit.

**Spec:** `docs/proposals/ui.md` §2.1 »Lebensdauer« (Warten auf Warteschlange und Hintergrund-Syncs), §2.3.2, §2.3.3, §2.15 »CSRF« und »Uploads«; dazu `docs/proposals/backe.md` §2.8 (Anhänge, `attachments.max_bytes`), §2.19 (Tools, Warteschlange, Ende). Gesamtplan `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (Global Constraints, Festlegungen »Schicht `src/tools/`«, »`batch` in der UI«, »`attachment_add` in der UI«, »Kontext je Backlog«; Review Focus 1 und 5). ui.md ist `in Umsetzung`.

## Global Constraints

Alle Global Constraints des Gesamtplans und der Pläne U1 und U2. Dazu für U3:

- MCP bleibt byte-gleich: Tool-Liste (`SPEC_TOOLS`, `test/mcp/schemas.test.ts`), Schemas, Ergebnisse und englische Texte. Alle MCP- und E2E-Golden-Files unverändert.
- Neue Tools: `surfaces: ['ui']`, Parameter in snake_case nach den CLI-Flags (`--carry-over` ↔ `carry_over`), Ergebnis-JSON identisch zum CLI-Befehl mit `--format json`. `description` englisch, kurz, im Stil der bestehenden.
- Jeder Text, den `src/tools/` oder `src/ui/` neu wirft, steht en + de in einer `*.messages.ts` (`catalog({en, de})`); MCP spricht weiter Englisch, weil `backe mcp` `setLocale('en')` setzt.
- `src/tools/**` importiert nichts aus `src/cli/**`; was CLI und Tool teilen (Repo-Check-JSON), wandert nach `src/services/views.ts`.
- Tests schreiben echt (Temp-Backlogs, echtes Git, Test-Keys per `ssh-keygen`); der Hintergrund-Sync läuft über `deps.sync` (Spawn-Hook), nie als echter Kindprozess, der den Test überlebt.

## Festlegungen für U3

| Stelle | Festlegung |
| --- | --- |
| Schreibrecht | Das `ToolEnv` eines Backlogs löst den Kontext mit `uiContext(input, start, backlog)` auf und ruft danach `requireWriter(ctx)`. Damit verlangt **jeder** Tool-Aufruf und jeder Upload eine schreibende Identität, auch lesende Tools — wie MCP, das ohne sie gar nicht startet. Lesen geht über die GET-Endpunkte. Fehler: der `usage`-Fehler von `requireWriter` → 400 mit `hint`. |
| Warteschlange | Ein `ToolEnv` je Backlog-Name, angelegt beim ersten Aufruf, gehalten bis zum Ende: eigene `writeQueue()`, eigene `pendingStarts()`; `allowDelete: true`; kein `cwd`; `surface: 'ui'`; `deps` aus `UiOptions.tools`. |
| `surface` im `ToolEnv` | Neues Pflichtfeld `surface: ToolSurface`. `rejectBatchOps` nennt die Tür in der Meldung: MCP wörtlich wie heute (`line 2: 'project.create' is not available in MCP mode`), UI `… is not available in backe ui`. |
| Content-Type | `POST …/tools/<tool>` verlangt den Medientyp `application/json`, `PUT …/attachments/<name>` `application/octet-stream`; Parameter (`; charset=utf-8`) und Groß-/Kleinschreibung zählen nicht. Sonst 403 `forbidden` als `deniedJson`, bevor ein Byte des Bodys gelesen oder ein Kontext aufgelöst wird. Geprüft in `write-api.ts`, nicht in `checkRequest` (das bleibt methoden- und pfadneutral). |
| JSON-Body | Höchstens `TOOL_BODY_LIMIT = 16 MiB` (16 777 216 Bytes); darüber Abbruch beim Lesen, `BackeError('validation')` → 400, `Connection: close`. Leerer Body = `{}`. Kein gültiges JSON oder kein Objekt → `usage` 400. |
| Schemafehler | `def.input.safeParse(body)`; Fehlschlag → `BackeError('usage', m.invalidArguments(tool), { details: { issues: [{path, message}] } })` → 400. `path` als mit `.` verbundener String, leer für die Wurzel. |
| Unbekanntes Tool | Name nicht in `toolsFor('ui', {allowDelete: true})` → 404 `not_found` mit `m.unknownTool(name)`. Andere Methoden als POST auf `…/tools/<tool>` und andere als GET/HEAD/PUT auf `…/attachments/<name>` → 404 wie jeder unbekannte Endpunkt. |
| Antwort | 200 mit dem Ergebnis-JSON des Tools, wie MCP es als Text liefert (`toolResult`): `undefined` wird `null`. |
| `repo_check` | `kind: 'read'`. Ergebnis wie `repo check --format json`: `{repos, notices}`, immer 200 — auch mit Befunden der Stufe `error`. Den Exit-Code des CLI (`repoCheckExit`) gibt es in der UI nicht; die Befunde tragen ihre Stufe selbst. |
| `user_add` | Parameter `key` ist die Public-Key-Zeile (`ssh-ed25519 AAAA… [kommentar]`), kein Pfad (ui.md §2.15). Der Service `addUser` nimmt künftig die Zeile; das CLI liest die Datei vorher mit `readPublicKey` wie bisher. |
| `user_create_agent` | Ergebnis wie das CLI: `{handle, key_path, commit}`; der private Key landet wie dort unter `<BACKE_HOME>/keys/<backlog>/<handle>`. |
| Upload | Temp-Verzeichnis je Serverprozess: `mkdtemp(join(tmpdir(), 'backe-ui-'))` beim ersten Upload, entfernt in `close()`. Je Upload eine Datei `upload-<randomUUID()>` darin, gelöscht in `finally`. Grenze `attachments.max_bytes` aus `attachmentLimits(ctx)`: `Content-Length` darüber → sofort Fehler; sonst zählt der Server beim Streamen und bricht beim ersten Byte über der Grenze ab. Fehler in beiden Fällen `attachmentTooLarge(name, size, limits)` (dieselbe Meldung wie das CLI; `size` = `Content-Length` bzw. gezählte Bytes) mit `Connection: close`. Danach `loadAttachmentSource({name, path}, {base: tempDir, home, maxBytes, lfs, confine: true})` und `addAttachment` über `runTool(env, 'write', …)` — dieselbe Warteschlange wie die Tools. Antwort wie `attachment_add`. |
| Anhangsname | Vor dem Lesen des Bodys gegen `ATTACHMENT_NAME_RE` geprüft (`validation` 400 mit der Meldung des Services); der Name bestimmt nie einen Pfad. |
| Ende | `close()`: Server nimmt nichts Neues an → laufende Handler fertig (`working`) → für jedes `ToolEnv` `queue.run(noop)` und `pending.settled()` → Temp-Verzeichnis weg → `hub.close()` → `closeAllConnections()`. Ein Upload, der beim Ende noch Bytes liest, gehört zu `working` und wird abgewartet. |

## Review Focus

1. **Fremde Webseite im selben Browser** — `POST` mit `Content-Type: text/plain` und fremdem `Origin`, derselbe ohne `Origin`, mit eigenem `Origin` aber `text/plain`, ein `PUT`-Upload mit `multipart/form-data`. Erwartet: 403, kein Commit (Ref unverändert), kein Body gelesen. → Task 4 `a simple cross-site post never writes`, Task 5 `an upload with another content type writes nothing`.
2. **Nur-lesen-Identität** — Handle ohne Key in der User-Config. Erwartet: jeder `POST …/tools/*` (auch `issue_list`) und jeder Upload ist 400 mit `hint`, `GET /state` und der Event-Stream laufen. → Task 4 `a read-only identity cannot write`.
3. **Ende mitten in der Arbeit** — drei Writes in der Warteschlange, ein Hintergrund-Sync danach, ein Upload, der noch liest; SIGTERM. Erwartet: alle drei Commits stehen, der Sync-Spawn wurde gerufen, das Temp-Verzeichnis ist weg, `close()` hängt nicht. → Task 4 `close waits for queued writes and their background sync`, Task 5 `close removes the upload temp dir`.
4. **Übergroße oder kaputte Bodies** — 17 MiB JSON, kein JSON, ein Array statt Objekt, ein Upload über `max_bytes` mit und ohne `Content-Length` (chunked). Erwartet: 400, Server liest nicht weiter, kein Commit, keine Temp-Datei bleibt. → Task 4 `a body over the limit is cut off`, Task 5 `an upload over max_bytes is cut off while streaming`.
5. **Parität mit MCP und CLI** — dasselbe Tool über UI und MCP bzw. CLI `--format json` auf demselben Backlog-Stand. Erwartet: gleiches JSON bis auf `commit` und erzeugte IDs. → Task 2 und 3 (je Tool), Task 6 `tool json equals the mcp json`.

---

### Task 1: Tool-Texte zweisprachig, Tür im `ToolEnv`

**Files:**
- Create: `src/tools/tools.messages.ts`
- Modify: `src/tools/run.ts` (`ToolEnv.surface`), `src/tools/write.ts` (alle `BackeError`-Texte aus `m`, `rejectBatchOps(ops, allowDelete, surface)`), `src/mcp/server.ts` (`surface: 'mcp'`), `src/tools/write.test.ts`, `src/tools/run.test.ts` und jede andere Stelle, die ein `ToolEnv` baut

**Interfaces:**
- Produces: `ToolEnv = { …bisher, surface: ToolSurface }`; `rejectBatchOps(ops, allowDelete: boolean, surface: ToolSurface): void`; `m` in `tools.messages.ts` mit den acht bisherigen Texten aus `write.ts` (en wörtlich wie heute) plus `opNotAvailable(line, op, surface)`.

- [ ] **Step 1: Failing tests** in `src/tools/write.test.ts`: `batch names the mcp door in mcp` (Meldung wörtlich `line 1: 'project.create' is not available in MCP mode`), `batch names backe ui in the ui` (`line 1: 'project.create' is not available in backe ui`), `tool errors speak german under de` (`setLocale('de')`, `issue_rank` ohne Position → deutscher Text, Code `usage`).
- [ ] **Step 2:** `pnpm vitest run src/tools` → FAIL.
- [ ] **Step 3:** Implementieren. Deutsche Texte im Ton der übrigen `*.messages.ts`.
- [ ] **Step 4:** `pnpm vitest run src/tools src/mcp test/mcp test/e2e/mcp.test.ts` → PASS, MCP-Goldens unverändert.
- [ ] **Step 5: Commit** `refactor: Tool-Texte zweisprachig, ToolEnv kennt seine Tür`

---

### Task 2: Verwaltungs-Tools für Issues, Kommentare, Anhänge, Projekte, Sprints

**Files:**
- Create: `src/tools/admin.ts`, `src/tools/admin.test.ts`
- Modify: `src/tools/catalog.ts` (`TOOLS` um `ADMIN_TOOLS`), `src/tools/catalog.test.ts`

**Interfaces:**
- Consumes: `tool`, `ToolDef` (`define.ts`); Services `linkIssue`, `unlinkIssue`, `editComment`, `deleteComment`, `removeAttachment`, `createProject`, `moveProject`, `removeProject`, `createSprint`, `closeSprint`; `outcomeJson`.
- Produces: `ADMIN_TOOLS: readonly ToolDef[]`, alle `surfaces: ['ui']`, `kind: 'write'`, Ergebnis `outcomeJson(…)`. Schemas (`z.strictObject`):

| Tool | Parameter |
| --- | --- |
| `issue_link` | `id`, `target` |
| `issue_unlink` | `id`, `repo` |
| `comment_edit` | `id`, `comment`, `body` |
| `comment_delete` | `id`, `comment` |
| `attachment_rm` | `id`, `name` |
| `project_create` | `path`, `title?`, `lead?`, `body?` |
| `project_mv` | `from`, `to` |
| `project_rm` | `path`, `reassign?`, `detach?: boolean` |
| `sprint_create` | `slug`, `title?`, `start?`, `end?`, `body?` |
| `sprint_close` | `slug`, `carry_over?` |

Task 3 hängt `repo_*` und `user_*` an dieselbe Liste.

- [ ] **Step 1: Failing tests** in `admin.test.ts` mit einem `ToolEnv` wie in `write.test.ts` (`surface: 'ui'`) gegen `testBacklog()`, je Tool ein Test, der `invokeTool` mit dem Ergebnis des gleichen CLI-Aufrufs (`--format json`, über die Helfer aus `test/e2e/tools.ts` oder den Service + `outcomeJson`) vergleicht, `commit` ausgenommen: `issue_link and issue_unlink match the cli`, `comment_edit and comment_delete match the cli`, `attachment_rm matches the cli`, `project_create, project_mv and project_rm match the cli`, `project_rm refuses reassign with detach` (`usage`), `sprint_create and sprint_close match the cli`, `unknown parameters are rejected by the schema` (`safeParse` eines Tools mit `{x: 1}` scheitert). In `catalog.test.ts`: `ui surface lists the spec tools plus the admin tools` (genaue Namensliste aus ui.md §2.3.2 plus `SPEC_TOOLS` plus `issue_delete`).
- [ ] **Step 2:** `pnpm vitest run src/tools` → FAIL.
- [ ] **Step 3:** Implementieren; Ein-/Umbau der Argumente wie in `write.ts` (nur gesetzte Felder weiterreichen, `exactOptionalPropertyTypes`).
- [ ] **Step 4:** `pnpm vitest run src/tools test/mcp` → PASS; `mcp surface lists exactly the spec tools` bleibt grün.
- [ ] **Step 5: Commit** `feat: Verwaltungs-Tools für backe ui: Links, Kommentare, Anhänge, Projekte, Sprints`

---

### Task 3: Verwaltungs-Tools für Repos und Users

**Files:**
- Modify: `src/tools/admin.ts`, `src/tools/admin.test.ts`, `src/services/users.ts` (`addUser` nimmt `key: string`), `src/cli/commands/user.ts` (liest die Datei mit `readPublicKey`), `src/services/views.ts` (`repoCheckJson`), `src/cli/commands/repo.ts` (nutzt `repoCheckJson`), `src/services/users.test.ts`

**Interfaces:**
- Produces: `addUser(ctx, { handle: string; key: string; name?: string; agent?: boolean; operator?: string }, deps?)` — `key` wird mit `parseSshPublicKey` geprüft (Fehler wie beim Lesen aus einer Datei). `repoCheckJson(r: { repos: RepoCheck[]; notices: Notice[] }): Record<string, unknown>` = bisheriges `{ repos: checks.map(checkJson), notices: nonEmpty(notices) }`.

| Tool | Parameter | `kind` | Ergebnis |
| --- | --- | --- | --- |
| `repo_add` | `url`, `name?`, `ref?`, `body?` | write | `outcomeJson` |
| `repo_rm` | `name` | write | `outcomeJson` |
| `repo_check` | `names?: string[]`, `remote?: boolean`, `fresh?: boolean` | read | `repoCheckJson`, nie ein Fehler aus `repoCheckExit` |
| `user_add` | `handle`, `key`, `name?`, `agent?: boolean`, `operator?` | write | `outcomeJson` |
| `user_create_agent` | `handle`, `name?` | write | `{handle, key_path, commit}` |
| `user_revoke_key` | `handle`, `fingerprint` | write | `outcomeJson` |
| `user_rm` | `handle` | write | `outcomeJson` |

- [ ] **Step 1: Failing tests** in `admin.test.ts`: `repo_add and repo_rm match the cli`, `repo_check reports errors without failing` (Repo mit ungültigem Ref → Ergebnis enthält einen Befund `level: 'error'`, kein Throw; JSON gleich `repo check --format json` stdout), `user_add takes the public key line` (Key aus `ssh-keygen`, danach `user show` zeigt den Fingerprint), `user_add rejects a broken key line` (`validation`), `user_create_agent writes the key and answers like the cli` (`key_path` existiert, `commit` ist ein SHA), `user_revoke_key and user_rm match the cli`. In `users.test.ts` die bestehenden `addUser`-Tests auf `key` umstellen.
- [ ] **Step 2:** `pnpm vitest run src/tools src/services/users.test.ts` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `pnpm vitest run src/tools src/services src/cli test/e2e` → PASS; Goldens `repo-check.json`, `repo-check.txt` unverändert.
- [ ] **Step 5: Commit** `feat: Verwaltungs-Tools für backe ui: Repos und Users`

---

### Task 4: Tool-Endpunkt

**Files:**
- Create: `src/ui/body.ts`, `src/ui/body.test.ts`, `src/ui/tools.ts`, `src/ui/write-api.ts`, `src/ui/write-api.messages.ts`, `src/ui/write-api.test.ts`
- Modify: `src/ui/routes.ts` (`writeRoute`), `src/ui/routes.test.ts`, `src/ui/server.ts` (`UiOptions.tools?: ToolDeps`, Dispatch, `close`), `test/helpers/ui.ts` (`post(path, body, headers?)`, `put(path, bytes, headers?)` mit eigenem `Origin` und passendem Content-Type als Default)

**Interfaces:**
- Consumes: `toolsFor`, `invokeTool` (`catalog.ts`); `toolResult`-Semantik (`undefined` → `null`); `uiContext`, `StartInput`; `requireWriter`; `deniedJson`, `sendJson`, `sendError`.
- Produces:

```ts
// routes.ts
export type WriteRoute =
  | { kind: 'tool'; backlog: string; tool: string }
  | { kind: 'upload'; backlog: string; id: string; name: string };
export function writeRoute(method: string, url: URL): WriteRoute | undefined; // POST …/tools/<t>, PUT …/attachments/<n>

// body.ts
export const TOOL_BODY_LIMIT = 16_777_216;
export function mediaType(header: string | undefined): string | undefined; // klein, ohne Parameter
export function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown>;

// tools.ts
export class UiTools {
  constructor(input: StartInput, start: string | undefined, deps?: ToolDeps);
  envFor(backlog: string): ToolEnv;   // ein Env je Name, context() mit requireWriter
  settled(): Promise<void>;           // Warteschlangen und pending aller Envs
}

// write-api.ts
export type WriteEnv = { tools: UiTools; uploads: UploadDir };  // UploadDir aus Task 5
export function handleWrite(route: WriteRoute, req: IncomingMessage, res: ServerResponse, env: WriteEnv): Promise<void>;
```

`handleWrite` für `tool`: Content-Type prüfen → Tool suchen → Body lesen → `safeParse` → `invokeTool(def, env.tools.envFor(b), args)` → 200. Reihenfolge so, dass ein 403 nie einen Body liest und ein 404 nie einen Kontext auflöst. Ein Fehler nach gesendeten Headern beendet die Verbindung (wie `handleRead`).

- [ ] **Step 1: Failing tests.** `body.test.ts`: `mediaType ignores parameters and case`, `an empty body is an empty object`, `a body over the limit is cut off` (Fehler `validation`, Stream nicht weiter gelesen), `no json is a usage error`, `an array is a usage error`. `routes.test.ts`: `tool and upload routes`, `other methods are no write route`. `write-api.test.ts` über HTTP mit `UiHarness` (Port 0, echtes Backlog, `tools.sync.spawn` als Aufzeichner):
  - `issue_create answers with the write json` (Keys `commit`, `op`, `id`; `commit` ist der neue `HEAD`)
  - `a write arrives as a patch on the event stream` (Stream offen, `issue_create`, Patch mit dem neuen Issue)
  - `issue_delete works without a gate` und `batch accepts issue.delete in the ui`
  - `batch names backe ui for an unavailable op` (400, Meldung aus Task 1)
  - `an admin tool runs over http` (`project_create`, danach in `/state.projects`)
  - `an unknown tool is 404`, `get on a tool path is 404`
  - `a schema violation is 400 with details` (`issue_move` ohne `to` → `details.issues[0].path === 'to'`)
  - `a simple cross-site post never writes` (fremder `Origin` + `text/plain` → 403; kein `Origin` → 403; eigener `Origin` + `text/plain` → 403 `forbidden`; `HEAD` der Arbeitskopie vorher = nachher)
  - `a read-only identity cannot write` (Handle ohne Key: `issue_create` und `issue_list` → 400 mit `hint`; `GET /state` → 200)
  - `writes of one backlog run one after another` (fünf `issue_create` parallel → fünf Commits linear, alle 200)
  - `a background sync follows a commit` (Spawn-Aufzeichner gerufen, Tool-Antwort wartet nicht darauf)
  - `close waits for queued writes and their background sync` (drei Writes parallel, `close()` sofort danach → drei Commits, Spawn gerufen, `close()` erfüllt)
  - `errors map exit codes to status` (`issue_move` auf unbekannte ID → 404, `issue_claim` eines vergebenen Issues → 409)
- [ ] **Step 2:** `pnpm vitest run src/ui` → FAIL.
- [ ] **Step 3:** Implementieren; `UiTools` und das spätere `UploadDir` in `createUiServer` anlegen, `close()` nach der Reihenfolge der Festlegung »Ende«.
- [ ] **Step 4:** `pnpm vitest run src/ui test/e2e/ui.test.ts` → PASS; Coverage für `src/ui/**` hält 90/85.
- [ ] **Step 5: Commit** `feat: Tool-Endpunkt von backe ui mit Warteschlange je Backlog`

---

### Task 5: Upload

**Files:**
- Create: `src/ui/upload.ts`, `src/ui/upload.test.ts`
- Modify: `src/ui/write-api.ts` (`upload`), `src/ui/write-api.messages.ts`, `src/ui/server.ts` (`UploadDir` anlegen und in `close()` entfernen)

**Interfaces:**
- Consumes: `UiTools.envFor`, `runTool`, `attachmentLimits`, `attachmentTooLarge`, `loadAttachmentSource`, `addAttachment`, `outcomeJson`, `ATTACHMENT_NAME_RE`.
- Produces:

```ts
export type UploadDir = { file(): Promise<string>; remove(): Promise<void> }; // lazy mkdtemp, je Aufruf ein neuer Name
export function uploadDir(): UploadDir;
/** Schreibt den Body nach `path`; bricht ab, sobald mehr als `max` Bytes kamen (max null = ohne Grenze). */
export function receiveUpload(req: IncomingMessage, path: string, max: number | null): Promise<{ size: number } | { tooLarge: number }>;
```

- [ ] **Step 1: Failing tests.** `upload.test.ts` (ohne HTTP-Server, mit einem `PassThrough` als Request): `receive writes all bytes`, `receive stops at the first byte over max`, `the dir is created once and removed`. `write-api.test.ts` über HTTP:
  - `an upload becomes an attachment` (PNG-Bytes, danach `GET …/attachments/<name>` liefert dieselben Bytes; Antwort gleich `attachment_add`-JSON)
  - `an upload over max_bytes is cut off while streaming` (Config `attachments.max_bytes: 1024`, 4096 Bytes chunked ohne `Content-Length` → 400 mit der CLI-Meldung, kein Commit, Temp-Verzeichnis leer)
  - `a content-length over max_bytes is refused before reading`
  - `an upload with another content type writes nothing` (`multipart/form-data` → 403, kein Commit)
  - `an invalid attachment name writes nothing` (`../x` percent-kodiert, `a b` → 400, keine Temp-Datei)
  - `the temp file is gone after success and failure`
  - `uploads share the queue with tools` (Upload und `issue_update` parallel auf dasselbe Issue → zwei Commits nacheinander)
  - `close removes the upload temp dir`
- [ ] **Step 2:** `pnpm vitest run src/ui` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `pnpm vitest run src/ui` → PASS.
- [ ] **Step 5: Commit** `feat: Anhänge per PUT hochladen in backe ui`

---

### Task 6: Parität über den gebauten Befehl, Docs, Abnahme

**Files:**
- Modify: `test/e2e/ui.test.ts`, `docs/proposals/ui.md`, `ROADMAP.md`

- [ ] **Step 1: E2E-Test** `tool json equals the mcp json` in `test/e2e/ui.test.ts`: zwei gleiche Backlogs (oder derselbe Stand vor und nach Reset), `issue_create`, `issue_move`, `comment_add`, `batch` über `backe ui` (gespawnt, `--port 0`) und über `backe mcp` (`connectMcp`) → gleiches JSON bis auf `commit` und erzeugte IDs; dazu `SIGTERM` direkt nach einem Write → Exit 0, Commit steht.
- [ ] **Step 2:** `pnpm vitest run test/e2e/ui.test.ts` → PASS.
- [ ] **Step 3: ui.md nachziehen** — Status-Satz (gebaut: §2.3.2, §2.15 vollständig, §2.1 vollständig; offen: §2.4.1 Punkt 3 und alles ab §2.5); die Festlegungen für U3 als Gegenwart in §2.3.2 (Schreibrecht für alle Tools, Content-Type → 403, Body-Grenze 16 MiB, Schemafehler mit `details.issues`, unbekanntes Tool 404, `repo_check` als Bericht ohne Fehler-Status, `user_add` mit Key-Zeile, `user_create_agent`-Ergebnis, `batch`-Ops) und in §2.15 »Uploads« (Temp-Verzeichnis je Prozess, Abbruch beim Streamen, Name vor dem Lesen geprüft).
- [ ] **Step 4:** `ROADMAP.md`: Server-Writes abhaken.
- [ ] **Step 5:** `mise run check`, `mise run smoke` grün; MCP- und E2E-Golden-Files byte-gleich (`git diff --stat test/e2e/golden test/mcp` leer).
- [ ] **Step 6: Commit** `docs: ui.md beschreibt die gebauten Server-Writes`
