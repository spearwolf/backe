# backe ui U0 — Vorlauf in BK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Voraussetzungen für `backe ui` in BK schaffen, ohne Verhalten zu ändern: eine reine Modul-Hülle, die das Web-Bundle importieren darf, ein reiner Listenfilter, die Sync-Status-Ansicht in `views.ts` und ein adapterneutraler Tool-Katalog, aus dem MCP heute und die UI ab U3 registrieren.

**Architecture:** Vier Refactorings, je eins pro Task, plus Docs. Die reine Hülle ist die transitive Import-Menge von `WEB_ENTRIES`; ein Konventionstest berechnet sie per Regex über `import`/`export … from` (Typ-Importe ausgenommen) und verbietet darin `node:`, nackte Imports außer `zod`, `Buffer` und ungeschütztes `process`. Der Tool-Katalog `src/tools/` liegt zwischen `services/` und den Adaptern; `src/mcp/` behält nur SDK-Anbindung, Fehlergrenze, Resource und Start.

**Tech Stack:** unverändert (Node 26, TypeScript strict, Vitest, Biome). Keine neue Abhängigkeit.

**Spec:** `docs/proposals/ui.md` §2.2, §3.3, §3.5, §4.2; `docs/proposals/backe.md` §2.19, §2.20. Gesamtplan `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (Befunde, Festlegungen »Schicht `src/tools/`«, »Event-ID«, »Theme ohne Aufblitzen«). ui.md ist `spezifiziert`.

## Global Constraints

Alle Global Constraints des Gesamtplans. Dazu für U0:

- **Keine Verhaltensänderung.** `test/mcp/golden/tools.json` und alle Dateien unter `test/e2e/golden/` bleiben byte-gleich; kein bestehender Test ändert seine Erwartung. Verschobene Tests behalten Namen und Assertions.
- Re-Exports an der alten Stelle halten Aufrufer stabil, wo der Plan es sagt (`Env`/`envValue` in `context/paths.ts`); sonst werden Imports direkt umgestellt, kein Re-Export-Friedhof.
- `src/tools/**` gehört zu `QUIET_LAYERS` in `test/conventions.test.ts` (schreibt nie nach stdout).
- Coverage-Gate: `'src/tools/**': { lines: 90, branches: 85 }` in `vitest.config.ts`.

## Review Focus

1. **Locale ohne `process`** — Ein Modul der Hülle ruft `locale()` im Browser, bevor `setLocale` lief. Erwartet: `'en'`, kein `ReferenceError`. → Task 1 `locale falls back to en without process`.
2. **Base64-Kanten im SSH-Key** — Key mit Padding `=`/`==`, Blob kürzer als 4 Bytes, Typlänge größer als der Blob. Erwartet: dieselben `validation`-Fehler wie vorher mit `Buffer`. → Task 1 `parseSshPublicKey rejects truncated blobs` (bestehende Tests in `src/core/ssh.test.ts` bleiben und laufen gegen die neue Umsetzung).
3. **Filter-Kombinationen** — `tree` mit Filter, der den Parent ausschließt; `assignee: 'none'`; `states: 'all'` mit `mode: 'ready'`. Erwartet: exakt die Reihenfolge und Tiefe, die `listIssues` vorher lieferte. → Task 2 `selectIssues equals listIssues on the basic fixture` (Property-Test über `fast-check`).
4. **`issue_delete`-Gate** — MCP ohne `--allow-delete` darf weder das Tool noch `issue.delete` im `batch` sehen; ein `ui`-Eintrag darf nie in MCP auftauchen. → Task 4 `mcp surface lists exactly the spec tools`, `ui-only tools never reach mcp`.
5. **Warteschlange über Adapter hinweg** — Ein Fehler im Write hält die folgenden nicht auf; `settled()` wartet auch auf währenddessen Hinzugekommenes. Erwartet: wie bisher. → Task 4: die bestehenden Tests aus `src/mcp/tool.test.ts` wandern unverändert nach `src/tools/run.test.ts`.

---

### Task 1: Reine Hülle und Konventionstest

**Files:**
- Create: `src/core/env.ts`, `src/core/fingerprint.ts`, `src/core/fingerprint.test.ts`, `test/helpers/web-closure.ts`
- Modify: `src/i18n/locale.ts`, `src/context/paths.ts:8-16`, `src/core/ids.ts:1,24-26`, `src/core/ssh.ts`, `src/ops/policy.ts:7`, `src/services/quarantine.ts:19`, `src/services/verify-state.ts:15` und alle weiteren Importeure von `sshFingerprint` (`grep -rn sshFingerprint src test`), `test/conventions.test.ts`, `src/i18n/i18n.test.ts`

**Interfaces:**
- Produces: `src/core/env.ts`: `export type Env`, `export function envValue(env: Env, name: string): string | undefined` (verschoben, unverändert). `src/core/fingerprint.ts`: `export function sshFingerprint(line: string): string` (verschoben, nutzt `node:crypto`, gehört nicht zur Hülle). `test/helpers/web-closure.ts`: `export const WEB_ENTRIES: readonly string[]`, `export function webClosure(entries: readonly string[]): Promise<Map<string, ClosureFile>>` mit `ClosureFile = { imports: string[]; text: string }` (nur Laufzeit-Imports, Pfade relativ zum Repo).

- [ ] **Step 1: Failing test in `test/conventions.test.ts`**

```ts
test('the web closure imports nothing from node', async () => {
  const files = await webClosure(WEB_ENTRIES);
  const offending = [...files].flatMap(([file, f]) => [
    ...f.imports.filter((s) => s.startsWith('node:') || (!s.startsWith('.') && s !== 'zod')).map((s) => `${file}: import ${s}`),
    ...(/\bBuffer\b/.test(stripComments(f.text)) ? [`${file}: Buffer`] : []),
    ...(/(?<!globalThis\.)\bprocess\b/.test(stripComments(f.text)) ? [`${file}: process`] : []),
  ]);
  expect(offending).toEqual([]);
});

test('the web closure check catches every form it names', async () => {
  // gegen kleine Temp-Dateien: `import x from 'node:fs'`, `export { y } from 'yaml'`,
  // `Buffer.from(…)`, `process.env.X`; `import type { Z } from 'node:fs'` und
  // `globalThis.process?.env` zählen nicht.
});
```

`WEB_ENTRIES = ['src/ops/graph.ts', 'src/ops/issue-query.ts', 'src/core/schemas.ts', 'src/core/state.ts', 'src/core/ids.ts', 'src/i18n/catalog.ts']`. Bis Task 2 existiert `src/ops/issue-query.ts` nicht — Task 1 führt die Liste ohne sie, Task 2 ergänzt sie. `stripComments` entfernt `//`- und `/* */`-Kommentare (Doku-Kommentare nennen `Buffer` gelegentlich).

- [ ] **Step 2: Test laufen lassen**

Run: `pnpm vitest run test/conventions.test.ts -t "web closure"`
Expected: FAIL; die Liste nennt mindestens `src/context/paths.ts: import node:fs/promises`, `src/core/ids.ts: import node:crypto`, `src/core/ssh.ts: import node:crypto`, `src/core/ssh.ts: Buffer`, `src/i18n/locale.ts: process`.

- [ ] **Step 3: `src/core/env.ts` anlegen, `locale.ts` und `paths.ts` umstellen**

`Env` und `envValue` wandern nach `src/core/env.ts`; `context/paths.ts` re-exportiert beide (`export { type Env, envValue } from '../core/env.ts';`), damit die neun Importeure unverändert bleiben. `locale.ts` importiert aus `../core/env.ts`. `initLocale(env: Env = globalThis.process?.env ?? {})`.

- [ ] **Step 4: `ids.ts` auf Web Crypto**

`defaultRandomBytes(n)` liefert `globalThis.crypto.getRandomValues(new Uint8Array(n))`; der `node:crypto`-Import fällt weg.

- [ ] **Step 5: `ssh.ts` ohne `Buffer`, Fingerprint auslagern**

`parseSshPublicKey` dekodiert per `atob` in ein `Uint8Array`, liest die Typlänge per `DataView.getUint32(0)` und vergleicht den Typ per `TextDecoder('latin1')`; `sameKey` vergleicht die Blobs elementweise. `sshFingerprint` zieht nach `src/core/fingerprint.ts` (`createHash` aus `node:crypto`, Ausgabe unverändert); alle Importeure stellen um. Den Fingerprint-Test aus `src/core/ssh.test.ts` nach `src/core/fingerprint.test.ts` verschieben.

- [ ] **Step 6: Test für `locale()` ohne `process`**

In `src/i18n/i18n.test.ts`: `test('locale falls back to en without process', () => expect(initLocale({})).toBe('en'))`. Danach `setLocale('de')` zurücksetzen (die Suite prüft deutsche Texte). Dass `locale.ts` `process` nur als `globalThis.process?.` anfasst, sichert der Konventionstest aus Step 1.

- [ ] **Step 7: Tests laufen lassen**

Run: `pnpm vitest run test/conventions.test.ts src/core src/i18n`
Expected: PASS, auch die bestehenden Tests in `src/core/ssh.test.ts`.

- [ ] **Step 8: Volle Prüfung und Commit**

Run: `mise run check`
Expected: PASS, Golden-Files unverändert (`git status --short test/` leer).

```bash
git add src/core src/i18n src/context/paths.ts src/ops/policy.ts src/services test/conventions.test.ts test/helpers/web-closure.ts
git commit -m "refactor: reine Modul-Hülle für das Web-Bundle"
```

---

### Task 2: Reiner Listenfilter `selectIssues`

**Files:**
- Create: `src/ops/issue-query.ts`, `src/ops/issue-query.test.ts`
- Modify: `src/services/issue-list.ts:55-211`, `src/services/sprints.ts:112-121`, `src/services/next.ts:86`, `test/helpers/web-closure.ts` (Eintrag `src/ops/issue-query.ts`)

**Interfaces:**
- Consumes: `isReady`, `isUnblockable` (`src/ops/graph.ts`), `matchesContext` (`src/ops/next.ts`), `compareIssues` (`src/ops/order.ts`), `propMatches`, `PropFilter` (`src/ops/props.ts`).
- Produces (`src/ops/issue-query.ts`):

```ts
export type IssueSelector = {
  /** `undefined` = offen (nicht settled), wie `issue list` ohne `--state`. */
  states?: State[] | 'all';
  filter: { project?: string[]; sprint?: string[]; repo?: string[] };
  exact?: boolean;
  /** Aufgelöster Handle oder `'none'`. */
  assignee?: string;
  creator?: string;
  /** Volle Issue-ID. */
  parent?: string;
  topLevel?: boolean;
  /** Geparst und gegen die Config geprüft. */
  props?: PropFilter[];
  hasProps?: string[];
  mode?: 'blocked' | 'unblockable' | 'ready';
  /** Kleingeschrieben; durchsucht Titel und `body` des Snapshots. */
  text?: string;
  tree?: boolean;
  sort?: 'rank' | 'created';
};
export type SelectedIssue = { issue: Issue; depth?: number; openDeps: boolean };
export function selectIssues(s: BacklogSnapshot, q: IssueSelector): SelectedIssue[];
export function matchesFilter(issue: Issue, filter: IssueSelector['filter'], exact: boolean): boolean;
export function hasOpenDeps(s: BacklogSnapshot, issue: Issue): boolean;
export function compareCreated(a: Issue, b: Issue): number;
```

`listIssues` behält Argumentprüfung, `openSnapshot`, `resolveHandle`, `resolveIssueRef`, `parsePropFilter`/`checkPropFilter`, `effectiveFilter`, `limit`/`truncated` und baut daraus den `IssueSelector`. `IssueListItem` wird zum Alias von `SelectedIssue`. `listSort` bleibt im Service.

- [ ] **Step 1: Failing tests in `src/ops/issue-query.test.ts`**

```ts
test('selectIssues keeps open issues by default and orders by rank', () => {
  const s = snap({ issues: [{ id: I(1), state: 'done' }, { id: I(2), rank: 2000 }, { id: I(3), rank: 1000 }] });
  expect(selectIssues(s, { filter: {} }).map((e) => e.issue.id)).toEqual([I(3), I(2)]);
});
test('tree puts children under a parent that is in the set, else at the root', () => { /* depth 0/1 */ });
test("assignee 'none' keeps only unassigned issues", () => { /* … */ });
test('text matches title or body, case-insensitive', () => { /* body über snap-Spec */ });
test('selectIssues equals listIssues on the basic fixture', async () => {
  // fast-check: zufällige IssueListQuery aus states/mode/tree/sort/assignee/topLevel über
  // test/fixtures/backlog-basic; listIssues(ctx, q).items gleich selectIssues(s, selector(q)).
});
```

- [ ] **Step 2: Tests laufen lassen**

Run: `pnpm vitest run src/ops/issue-query.test.ts`
Expected: FAIL mit »Failed to resolve import ./issue-query.ts«.

- [ ] **Step 3: `src/ops/issue-query.ts` implementieren, `issue-list.ts`, `sprints.ts`, `next.ts` umstellen**

`treeOrder`, `hasOpenDeps`, `matchesFilter`, `compareCreated` und das Prädikat `keep` aus `listIssues` wandern unverändert; `issue-list.ts` importiert sie von dort. Meldungen bleiben, wo sie gebraucht werden (`issue-list.messages.ts`); `issue-query.ts` wirft keine.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm vitest run src/ops src/services/issue-list.test.ts src/services/sprints.test.ts src/services/next.test.ts test/conventions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ops/issue-query.ts src/ops/issue-query.test.ts src/services/issue-list.ts src/services/sprints.ts src/services/next.ts test/helpers/web-closure.ts
git commit -m "refactor: Listenfilter von issue list als reines Modul"
```

---

### Task 3: `syncStatusJson` in `views.ts`

**Files:**
- Modify: `src/services/views.ts`, `src/services/views.test.ts`, `src/cli/commands/sync.ts:78-87`

**Interfaces:**
- Produces: `export function syncStatusJson(s: SyncStatus): Record<string, unknown>` in `src/services/views.ts` — Keys und Reihenfolge exakt wie `statusJson` heute: `remote` (`?? null`), `mode`, `unpushed`, `last_attempt`, `last_success`, `last_error`, `running`, `conflicts` (über die bestehende `conflictJson`, die mitwandert, falls sie nur in `sync.ts` lebt).

- [ ] **Step 1: Failing test in `src/services/views.test.ts`**

```ts
test('syncStatusJson keeps the keys of sync status --json', () => {
  expect(Object.keys(syncStatusJson(status({ remote: undefined })))).toEqual([
    'remote', 'mode', 'unpushed', 'last_attempt', 'last_success', 'last_error', 'running', 'conflicts',
  ]);
  expect(syncStatusJson(status({ remote: undefined })).remote).toBeNull();
});
```

- [ ] **Step 2: Test laufen lassen** — Run: `pnpm vitest run src/services/views.test.ts` — Expected: FAIL, `syncStatusJson` nicht exportiert.

- [ ] **Step 3: Verschieben; `sync.ts` ruft `syncStatusJson`.**

- [ ] **Step 4: Tests laufen lassen** — Run: `pnpm vitest run src/services/views.test.ts test/e2e/sync.test.ts` — Expected: PASS, Golden-Files unverändert.

- [ ] **Step 5: Commit**

```bash
git add src/services/views.ts src/services/views.test.ts src/cli/commands/sync.ts
git commit -m "refactor: JSON von sync status als Ansicht in views.ts"
```

---

### Task 4: Adapterneutraler Tool-Katalog `src/tools/`

**Files:**
- Create: `src/tools/run.ts`, `src/tools/run.test.ts`, `src/tools/catalog.ts`, `src/tools/catalog.test.ts`, `src/tools/read.ts`, `src/tools/write.ts`, `src/tools/sync.ts`
- Modify: `src/mcp/tool.ts`, `src/mcp/server.ts`, `src/mcp/read-tools.ts`, `src/mcp/write-tools.ts`, `src/mcp/sync-tools.ts`, `src/mcp/tool.test.ts`, `test/helpers/mcp.ts`, `test/conventions.test.ts:70`, `vitest.config.ts`
- Delete (Inhalt wandert): die Tool-Definitionen aus `src/mcp/read-tools.ts`, `write-tools.ts`, `sync-tools.ts`; übrig bleiben dort `registerIssueResource` und `startPeriodicSync` (Letzteres nach `src/tools/sync.ts`, weil die UI es in U2 braucht).

**Interfaces:**
- Produces (`src/tools/run.ts`, verschoben aus `src/mcp/tool.ts`, unverändert bis auf `ToolEnv`):

```ts
export type ToolKind = 'read' | 'write' | 'sync';
export type WriteQueue = { run<T>(fn: () => Promise<T>): Promise<T> };
export type Pending = { add(p: Promise<unknown>): void; settled(): Promise<void> };
export type ToolDeps = { sync?: SyncDeps; write?: WriteDeps; claim?: ClaimDeps };
export type ToolEnv = {
  context(): Promise<ResolvedContext>;
  deps?: ToolDeps;
  allowDelete: boolean;
  queue: WriteQueue;
  pending: Pending;
};
export function writeQueue(): WriteQueue;
export function pendingStarts(): Pending;
export function runTool<T>(env: ToolEnv, kind: ToolKind, ctx: ResolvedContext, run: () => Promise<T>): Promise<T>;
export function startPeriodicSync(ctx: ResolvedContext, deps?: SyncDeps): Promise<() => void>; // aus mcp/sync-tools.ts
```

- Produces (`src/tools/catalog.ts`):

```ts
export type ToolSurface = 'mcp' | 'ui';
export type ToolDef<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  input: S;
  kind: ToolKind | ((args: z.infer<S>) => ToolKind);
  check?: (args: z.infer<S>) => void;
  surfaces: readonly ToolSurface[];
  /** Nur MCP: registriert nur mit `--allow-delete`. */
  gate?: 'allowDelete';
  run(ctx: ResolvedContext, args: z.infer<S>, env: ToolEnv): Promise<unknown>;
};
export function tool<S extends z.ZodObject>(def: ToolDef<S>): ToolDef; // Typ-Helfer gegen die Generik-Lücke
export const TOOLS: readonly ToolDef[]; // read.ts, write.ts, sync.ts zusammengeführt; alle heutigen mit surfaces ['mcp', 'ui']
export function toolsFor(surface: ToolSurface, opts: { allowDelete: boolean }): ToolDef[];
/** Prüft und führt aus: check, kind, context, runTool. Wirft; die Fehlergrenze liegt beim Adapter. */
export function invokeTool(def: ToolDef, env: ToolEnv, args: unknown): Promise<unknown>;
```

`invokeTool` parst `args` nicht selbst — MCP lässt das SDK prüfen, die UI ruft vorher `def.input.parse` (U3). `context_get` wandert aus `mcp/server.ts` nach `src/tools/read.ts`. Das `allowDelete` des `batch`-Tools liest `env.allowDelete` statt `env.opts.allowDelete`; `deps` kommt aus `env.deps` statt `env.opts.deps`.

- Consumes in `src/mcp/tool.ts`: `registerTool(server: McpServer, env: ToolEnv, def: ToolDef): void` — registriert mit `{description, inputSchema: def.input}` und ruft `invokeTool` in der bestehenden Fehlergrenze (`toolResult`/`toolError` bleiben hier). `McpOptions` bleibt in `server.ts`; `createBackeMcp` baut `ToolEnv` mit `deps: opts.deps`, `allowDelete: opts.allowDelete`.

- [ ] **Step 1: Failing tests in `src/tools/catalog.test.ts`**

```ts
test('mcp surface lists exactly the spec tools', () => {
  expect(toolsFor('mcp', { allowDelete: false }).map((t) => t.name).sort()).toEqual([...SPEC_TOOLS].sort());
  expect(toolsFor('mcp', { allowDelete: true }).map((t) => t.name).sort()).toEqual([...SPEC_TOOLS, 'issue_delete'].sort());
});
test('ui surface gets issue_delete without a gate', () => {
  expect(toolsFor('ui', { allowDelete: false }).map((t) => t.name)).toContain('issue_delete');
});
test('ui-only tools never reach mcp', () => {
  const uiOnly = TOOLS.filter((t) => !t.surfaces.includes('mcp')).map((t) => t.name);
  for (const name of uiOnly) expect(toolsFor('mcp', { allowDelete: true }).map((t) => t.name)).not.toContain(name);
});
test('tool names are unique snake_case', () => { /* /^[a-z]+(_[a-z]+)*$/, keine Dubletten */ });
```

`SPEC_TOOLS` wandert aus `test/helpers/mcp.ts` in `test/helpers/tools.ts` (Re-Export in `mcp.ts`).

- [ ] **Step 2: Tests laufen lassen** — Run: `pnpm vitest run src/tools` — Expected: FAIL, Modul fehlt.

- [ ] **Step 3: `src/tools/run.ts` anlegen**; `WriteQueue`, `Pending`, `writeQueue`, `pendingStarts`, `committed`, `runTool` verschieben; Tests aus `src/mcp/tool.test.ts`, die nur diese betreffen, nach `src/tools/run.test.ts` verschieben (Namen und Assertions gleich).

- [ ] **Step 4: Definitionen nach `src/tools/{read,write,sync}.ts`** als `tool({...})`-Objekte, Inhalt der Handler unverändert; `propsArgs`, `rankPosition`, `rejectBatchOps`, `syncResult` wandern mit. `catalog.ts` führt `TOOLS` zusammen und implementiert `toolsFor` und `invokeTool`.

- [ ] **Step 5: MCP auf den Katalog umstellen** — `registerTools` in `server.ts` wird `for (const def of toolsFor('mcp', {allowDelete: opts.allowDelete})) registerTool(server, env, def)`; `registerIssueResource` bleibt. `QUIET_LAYERS` um `'tools'` erweitern; Coverage-Gate `'src/tools/**'` ergänzen.

- [ ] **Step 6: Tests laufen lassen**

Run: `pnpm vitest run src/tools src/mcp test/mcp test/e2e/mcp.test.ts test/conventions.test.ts`
Expected: PASS; `git status --short test/mcp/golden` leer.

- [ ] **Step 7: Volle Prüfung und Commit**

Run: `mise run check`
Expected: PASS inklusive Coverage-Schwellen.

```bash
git add src/tools src/mcp test/helpers test/conventions.test.ts vitest.config.ts
git commit -m "refactor: Tool-Katalog adapterneutral unter src/tools"
```

---

### Task 5: Proposals nachziehen

**Files:**
- Modify: `docs/proposals/backe.md` §2.19, §2.20; `docs/proposals/ui.md` §2.2, §2.4.3, §2.13, §4.2

Kein Test; Prüfung per Lesen und `grep`.

- [ ] **Step 1: BK §2.20** — Schichtendiagramm um `tools/` ergänzen (»Adapterneutraler Tool-Katalog: Namen, Schemas, Art, Ausführung; genutzt von `mcp/` und `ui/`«) zwischen `mcp/` und `services/`. Unter dem Diagramm ein Satz als Gegenwart: »Die reine Hülle — `src/core/`, `src/ops/graph.ts`, `src/ops/issue-query.ts` und ihre Laufzeit-Imports — kommt ohne `node:`-Module, `Buffer` und ungeschütztes `process` aus; ein Konventionstest prüft das. `sshFingerprint` liegt deshalb in `src/core/fingerprint.ts` außerhalb der Hülle.«
- [ ] **Step 2: BK §2.19** — ein Satz bei »dünner Adapter«: »Die Tool-Definitionen liegen adapterneutral in `src/tools/`; MCP registriert die Einträge für die Oberfläche `mcp`.«
- [ ] **Step 3: ui.md** — §2.2: `src/ops/issue-query.ts` in die Liste der reinen Module. §2.4.3: »Jedes Ereignis trägt `id: <boot>:<rev>`; `boot` sind 8 Hex-Zeichen Zufall je Serverprozess« und »stammt sie aus einem früheren Serverprozess (anderes `boot`)«. §2.13: »`index.html` lädt vor allen Styles synchron `/theme.js`, das das Theme setzt, damit nichts aufblitzt; ein Inline-Skript verbietet die CSP (§2.15).« §4.2: den Wunsch zur Reinheit streichen (BK hat ihn aufgenommen).
- [ ] **Step 4: Verweise prüfen** — Run: `grep -n "Inline-Skript\|id: <rev>" docs/proposals/ui.md` — Expected: keine Treffer mehr.
- [ ] **Step 5: Commit**

```bash
git add docs/proposals/backe.md docs/proposals/ui.md
git commit -m "docs: reine Hülle und Tool-Katalog in backe.md, Präzisierungen in ui.md"
```

Die Commit-Message nennt im Body jede Proposal-Änderung (Datei, Abschnitt, was), wie das Harness es verlangt.
