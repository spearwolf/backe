# backe M1 — Gerüst, `core`, `store` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein lauffähiges `backe`-Projekt mit CI, dessen reiner Kern Issues, Users, Projekte, Sprints und Repos kanonisch lesen, validieren und schreiben kann — noch ohne Git.

**Architecture:** `src/core/` hält Domain-Typen, zod-Schemas, Zustandsmodell, IDs, Namensregeln und URL-Normalisierung ohne jedes I/O. `src/store/` setzt darauf YAML-Subset-Parser, kanonischen Serializer, Layout und Dateizugriff. `src/cli/main.ts` ist vorerst nur `--version`.

**Tech Stack:** Node 26.13.1, pnpm 12.21.0, TypeScript strict (`nodenext`), Biome, Vitest + `@vitest/coverage-v8` + fast-check, tsdown; Runtime: `commander`, `zod` (≥ 4, wegen `z.toJSONSchema`), `yaml`, `jsonc-parser`.

**Spec:** `docs/proposals/backe.md` (Status `spezifiziert`), Gesamtplan `docs/superpowers/plans/2026-11-18-backe-gesamtplan.md`. Die Global Constraints, die Review-Focus-Zeilen 1–3 und die Planentscheidungen des Gesamtplans gelten hier.

## Global Constraints

Alle Global Constraints des Gesamtplans, dazu für M1:

- `core` importiert nichts aus `node:*` außer `node:crypto` (nur in `ids.ts`, für `randomBytes`) — und das nur als injizierbarer Default.
- Relative Imports enden auf `.ts`; `tsconfig` setzt `allowImportingTsExtensions`, `erasableSyntaxOnly`, `noEmit`, `noUncheckedIndexedAccess`. So laufen Skripte unter `scripts/` direkt mit Nodes Type-Stripping, tsdown bündelt.
- Unit-Tests liegen neben dem Code (`src/**/x.test.ts`), Integration und E2E unter `test/integration/` bzw. `test/e2e/`.

## Review Focus

Aus dem Gesamtplan, für M1 zuständig:

1. Strings, die YAML als anderen Typ läse, behalten Typ und Wert im Roundtrip → Task 6, `canonical roundtrip keeps ambiguous strings`.
2. CRLF, BOM, fehlender Schluss-Newline, `---` im Body, leerer Body → Task 6, `tolerates hand-edited file edges`.
3. Kommentare im Frontmatter → Fehler mit `datei:zeile`; unbekannte Keys bleiben und werden gemeldet → Task 6 und Task 7.

Zusätzlich hier: Eine einzelne kaputte Datei macht das Backlog nicht unlesbar → Task 7, `loadSnapshot reports broken files as problems`.

---

### Task 1: Projektgerüst und CI

**Files:**
- Create: `mise.toml`, `package.json`, `pnpm-lock.yaml` (generiert), `tsconfig.json`, `biome.json`, `vitest.config.ts`, `tsdown.config.ts`, `.gitignore`, `LICENSE`, `src/cli/main.ts`, `.github/workflows/ci.yml`
- Test: `test/e2e/version.test.ts`

**Interfaces:**
- Produces: `mise run lint|test|build|check`; `dist/cli.js` mit Shebang; `package.json` `name: "backe"`, `type: "module"`, `bin: {"backe": "dist/cli.js"}`, `engines.node: ">=26"`, `license: "MIT"`.

- [ ] **Step 1: Konfiguration anlegen**

`mise.toml`: `[tools] node = "26.13.1"`, `pnpm = "12.21.0"`; Tasks rufen die gleichnamigen `package.json`-Scripts auf: `lint` (`biome check . && tsc --noEmit`), `test` (`vitest run --coverage`), `build` (`tsdown`), `check` (lint → build → test, sequenziell).
Dependencies: `commander`, `zod`, `yaml`, `jsonc-parser`; devDependencies: `typescript`, `@biomejs/biome`, `vitest`, `@vitest/coverage-v8`, `fast-check`, `tsdown`, `@types/node` — jeweils aktuelle Version per `pnpm add`, Lockfile eingecheckt.
`vitest.config.ts`: `test.env = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', NO_COLOR: '1' }`; Coverage `provider: 'v8'`, `include: ['src/**']`, Thresholds `lines: 85, branches: 85` global sowie `'src/core/**'` und `'src/store/**'` mit je `lines: 90, branches: 90`.
`tsdown.config.ts`: Entry `src/cli/main.ts` → `dist/cli.js`, Banner `#!/usr/bin/env node`.
`LICENSE`: MIT, Copyright 2026 Wolfger Schramm.

- [ ] **Step 2: Failing E2E-Test schreiben**

```ts
// test/e2e/version.test.ts
import { execFileSync } from 'node:child_process';
import pkg from '../../package.json' with { type: 'json' };

test('backe --version prints the package version', () => {
  const out = execFileSync('node', ['dist/cli.js', '--version'], { encoding: 'utf8' });
  expect(out).toBe(`${pkg.version}\n`);
});
```

- [ ] **Step 3: `mise run check` → FAIL** (`dist/cli.js` fehlt bzw. `src/cli/main.ts` fehlt)

- [ ] **Step 4: `src/cli/main.ts`** — commander-Programm `backe` mit `.version(pkg.version)`, `parseAsync(process.argv)`.

- [ ] **Step 5: `mise run check` → PASS**

- [ ] **Step 6: `.github/workflows/ci.yml`** — auf `push` und `pull_request`; Matrix `os: [ubuntu-latest, macos-latest]`; Schritte: Checkout, `jdx/mise-action` (aktuelle Major-Version, vor dem Eintragen auf github.com nachsehen), `pnpm install --frozen-lockfile`, `biome ci .`, `mise run check`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "build: Projektgerüst mit mise, pnpm, Biome, Vitest, tsdown und CI"
```

---

### Task 2: Fehlertypen und Issue-IDs

**Files:**
- Create: `src/core/errors.ts`, `src/core/ids.ts`
- Test: `src/core/errors.test.ts`, `src/core/ids.test.ts`

**Interfaces:**
- Produces:
  - `type ErrorCode = 'usage' | 'validation' | 'ambiguous' | 'not_found' | 'conflict' | 'verify' | 'sync' | 'unexpected'`
  - `const EXIT_CODES: Readonly<Record<ErrorCode, number>>`
  - `class BackeError extends Error { readonly code: ErrorCode; readonly hint?: string; readonly details?: unknown; get exitCode(): number }` — Konstruktor `(code, message, opts?: { hint?: string; details?: unknown })`
  - `const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz'`
  - `isValidPrefix(p: string): boolean` — `/^[a-z]{2,6}$/`
  - `isIssueId(s: string, prefix?: string): boolean`
  - `generateIssueId(prefix: string, opts: { exists: (id: string) => boolean; issueCount: number; randomBytes?: (n: number) => Uint8Array }): string`
  - `shardOf(id: string): string`
  - `resolveShortId(input: string, ids: readonly string[]): string`

- [ ] **Step 1: Failing Tests**

```ts
// errors.test.ts
test.each([
  ['usage', 2], ['validation', 2], ['ambiguous', 2], ['not_found', 3],
  ['conflict', 4], ['verify', 5], ['sync', 6], ['unexpected', 1],
] as const)('%s maps to exit code %i', (code, exit) => {
  expect(new BackeError(code, 'x').exitCode).toBe(exit);
});

// ids.test.ts
const bytes = (...v: number[]) => () => Uint8Array.from(v);
test('generates <prefix>-<5 crockford chars>', () => {
  const id = generateIssueId('bk', { exists: () => false, issueCount: 0, randomBytes: bytes(7, 15, 3, 19, 2) });
  expect(id).toBe('bk-7f3k2');            // byte & 31 indexiert CROCKFORD
});
test('rerolls on local collision', () => {
  const seq = [bytes(7, 15, 3, 19, 2), bytes(10, 9, 1, 12, 0)];
  const id = generateIssueId('bk', { exists: (i) => i === 'bk-7f3k2', issueCount: 0, randomBytes: () => seq.shift()!() });
  expect(id).toBe('bk-a91c0');
});
test('switches to 6 chars above 50 000 issues', () => {
  expect(generateIssueId('bk', { exists: () => false, issueCount: 50_000 }).length).toBe(8);
  expect(generateIssueId('bk', { exists: () => false, issueCount: 50_001 }).length).toBe(9);
});
test('shard is the first two chars of the random part', () => {
  expect(shardOf('bk-7f3k2')).toBe('7f');
  expect(shardOf('abcdef-x2c8d9')).toBe('x2');
});
test('isIssueId rejects non-crockford chars and bad prefixes', () => {
  expect(isIssueId('bk-7f3k2')).toBe(true);
  expect(isIssueId('bk-7f3ki')).toBe(false);   // i ist nicht Crockford
  expect(isIssueId('b-7f3k2')).toBe(false);
  expect(isIssueId('bk-7f3k2', 'xy')).toBe(false);
});
describe('resolveShortId', () => {
  const ids = ['bk-7f3k2', 'bk-7f3m9', 'bk-a91c0'];
  test('full id passes', () => expect(resolveShortId('bk-a91c0', ids)).toBe('bk-a91c0'));
  test('unique short form', () => expect(resolveShortId('a91', ids)).toBe('bk-a91c0'));
  test('ambiguous lists candidates', () => {
    const err = catchErr(() => resolveShortId('7f3', ids));
    expect(err.code).toBe('ambiguous');
    expect(err.details).toEqual({ candidates: ['bk-7f3k2', 'bk-7f3m9'] });
  });
  test('shorter than 3 chars is usage', () => expect(catchErr(() => resolveShortId('7f', ids)).code).toBe('usage'));
  test('unknown is not_found', () => expect(catchErr(() => resolveShortId('zzz', ids)).code).toBe('not_found'));
});
```

`catchErr` ist ein Test-Helfer in `test/helpers/catch.ts`, der die geworfene `BackeError` zurückgibt.

- [ ] **Step 2: `pnpm vitest run src/core` → FAIL** (Module fehlen)

- [ ] **Step 3: Implementieren** — `errors.ts` nach Interfaces. `generateIssueId`: Länge 5, bei `issueCount > 50_000` Länge 6; jedes Byte `& 31` indexiert `CROCKFORD` (256 ist durch 32 teilbar, also gleichverteilt); Default-Quelle `crypto.randomBytes`; bei `exists` neu würfeln. `resolveShortId` vergleicht gegen den Teil nach dem Bindestrich.

- [ ] **Step 4: `pnpm vitest run src/core` → PASS**

- [ ] **Step 5: Commit** — `feat(core): Fehlertypen mit Exit-Codes und Issue-IDs`

---

### Task 3: Zustandsmodell

**Files:**
- Create: `src/core/state.ts`
- Test: `src/core/state.test.ts`

**Interfaces:**
- Consumes: `BackeError` (Task 2)
- Produces:
  - `type State = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' | 'on_hold' | 'cancelled' | 'rejected'`
  - `MAIN_LINE: readonly State[]` (`backlog, todo, in_progress, review, done`), `PAUSED: readonly State[]` (`blocked, on_hold`)
  - `isSettled(s: State): boolean` — `done | cancelled | rejected` (»erledigt«, §2.6/§2.22)
  - `normalizeStateInput(s: string): State` — akzeptiert `kebab-case`; Unbekanntes → `BackeError('usage')`
  - `type StateFields = { state: State; paused_from?: State; blocked_by?: string[] }`
  - `type TransitionKind = 'move' | 'resume' | 'reopen' | 'claim'`
  - `planTransition(cur: StateFields, kind: TransitionKind, opts: { to?: State; strict: boolean; blockedBy?: string[] }): StateFields | null` — `null` heißt No-op; Verstöße werfen `BackeError('validation')`

Die Prüfung »`done` am Parent mit offenen Sub-Issues« und die Zykluserkennung in `blocked_by` brauchen den Graphen und gehören nach M2.

- [ ] **Step 1: Failing Tests, tabellengetrieben**

```ts
const ok = (cur: StateFields, kind: TransitionKind, opts: object, want: StateFields | null) => ({ cur, kind, opts, want });
test.each([
  ok({ state: 'backlog' }, 'move', { to: 'in_progress', strict: false }, { state: 'in_progress' }),
  ok({ state: 'review' }, 'move', { to: 'review', strict: false }, null),
  ok({ state: 'todo' }, 'claim', { strict: true }, { state: 'in_progress' }),
  ok({ state: 'in_progress' }, 'move', { to: 'blocked', strict: false, blockedBy: ['bk-a91c0'] },
     { state: 'blocked', paused_from: 'in_progress', blocked_by: ['bk-a91c0'] }),
  ok({ state: 'blocked', paused_from: 'review', blocked_by: ['bk-a91c0'] }, 'move', { to: 'on_hold', strict: false },
     { state: 'on_hold', paused_from: 'review' }),
  ok({ state: 'on_hold', paused_from: 'review' }, 'resume', { strict: false }, { state: 'review' }),
  ok({ state: 'blocked', paused_from: 'todo', blocked_by: ['bk-a91c0'] }, 'move', { to: 'cancelled', strict: false },
     { state: 'cancelled' }),
  ok({ state: 'blocked', paused_from: 'review', blocked_by: ['bk-a91c0'] }, 'move', { to: 'done', strict: true },
     { state: 'done' }),                        // strict: Nachbar von paused_from
  ok({ state: 'done' }, 'reopen', { strict: false }, { state: 'backlog' }),
  ok({ state: 'rejected' }, 'reopen', { to: 'todo', strict: false }, { state: 'todo' }),
])('$cur.state --$kind--> ok', ({ cur, kind, opts, want }) => {
  expect(planTransition(cur, kind, opts as never)).toEqual(want);
});

const bad = (cur: StateFields, kind: TransitionKind, opts: object) => ({ cur, kind, opts });
test.each([
  bad({ state: 'backlog' }, 'move', { to: 'review', strict: true }),              // kein Nachbar
  bad({ state: 'todo' }, 'move', { to: 'blocked', strict: false }),               // blocked ohne blocked_by
  bad({ state: 'done' }, 'move', { to: 'todo', strict: false }),                  // nur reopen
  bad({ state: 'cancelled' }, 'move', { to: 'on_hold', strict: false }),
  bad({ state: 'todo' }, 'resume', { strict: false }),                            // nichts zu resumen
  bad({ state: 'todo' }, 'reopen', { strict: false }),
  bad({ state: 'done' }, 'reopen', { to: 'done', strict: false }),
  bad({ state: 'blocked', paused_from: 'backlog', blocked_by: ['bk-a91c0'] }, 'move', { to: 'review', strict: true }),
])('$cur.state --$kind--> rejected', ({ cur, kind, opts }) => {
  expect(catchErr(() => planTransition(cur, kind, opts as never)).code).toBe('validation');
});

test('every exit from blocked drops blocked_by', () => { /* Schleife über alle erlaubten Ziele aus blocked */ });
test('normalizeStateInput accepts kebab-case', () => expect(normalizeStateInput('in-progress')).toBe('in_progress'));
```

Ergänze die Tabelle so, dass jedes Paar (Quell-State × Ziel-State) mit `strict` an und aus genau einmal vorkommt; die Erwartung folgt den Regeln von `backe.md` §2.6 und der Planentscheidung »Nachbarschaft gemessen an `paused_from`«.

- [ ] **Step 2: `pnpm vitest run src/core/state.test.ts` → FAIL**

- [ ] **Step 3: `planTransition` implementieren** — `claim` ist ein Move nach `in_progress`, der `strict` aus `backlog`/`todo` ignoriert (§2.16.5); `reopen` ohne `to` → `backlog`, Ziel nur Hauptlinie ohne `done`.

- [ ] **Step 4: → PASS**

- [ ] **Step 5: Commit** — `feat(core): Zustandsmodell mit Übergangsregeln`

---

### Task 4: Namensregeln und Repo-URLs

**Files:**
- Create: `src/core/names.ts`, `src/core/url.ts`
- Test: `src/core/names.test.ts`, `src/core/url.test.ts`

**Interfaces:**
- Produces:
  - `HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,31}$/`, `RESERVED_HANDLES = ['me']`, `isHandle(s)`
  - `isProjectPath(s)` — Segmente `[a-z0-9][a-z0-9-]*`, 1–5 Ebenen; `projectAncestors('web/auth/sso'): ['web', 'web/auth']`
  - `isSprintSlug(s)` — `/^[a-z0-9][a-z0-9-]{0,63}$/`; `isRepoName(s)` — `/^[a-z0-9][a-z0-9._-]{0,63}$/`
  - `ATTACHMENT_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/`, `PROP_KEY_RE = /^[a-z][a-z0-9_.-]{0,63}$/`
  - `parseRepoRef(s: string): { name: string; ref?: string }` — `webapp@feat/sso`
  - `normalizeRepoUrl(input: string): string` — kanonische Form ohne Schema
  - `deriveRepoName(canonical: string, taken: ReadonlySet<string>): string`

- [ ] **Step 1: Failing Tests**

```ts
test.each([
  ['git@github.com:acme/webapp.git', 'github.com/acme/webapp'],
  ['https://github.com/acme/webapp', 'github.com/acme/webapp'],
  ['https://github.com/acme/webapp.git/', 'github.com/acme/webapp'],
  ['ssh://git@github.com/acme/webapp', 'github.com/acme/webapp'],
  ['ssh://git@GitHub.com:22/acme/webapp.git', 'github.com/acme/webapp'],
  ['gh:acme/webapp', 'github.com/acme/webapp'],
  ['/srv/git/backlog.git', 'file:/srv/git/backlog'],
  ['file:///srv/git/backlog.git', 'file:/srv/git/backlog'],
])('normalizeRepoUrl(%s)', (input, want) => expect(normalizeRepoUrl(input)).toBe(want));

test('unparseable url is usage error', () => expect(catchErr(() => normalizeRepoUrl('not a url')).code).toBe('usage'));
test('deriveRepoName falls back to owner prefix', () => {
  expect(deriveRepoName('github.com/acme/webapp', new Set())).toBe('webapp');
  expect(deriveRepoName('github.com/acme/webapp', new Set(['webapp']))).toBe('acme-webapp');
});
test('me is reserved', () => expect(isHandle('me')).toBe(false));
test('project depth max 5', () => {
  expect(isProjectPath('a/b/c/d/e')).toBe(true);
  expect(isProjectPath('a/b/c/d/e/f')).toBe(false);
});
test('parseRepoRef keeps slashes in ref', () =>
  expect(parseRepoRef('webapp@feat/sso')).toEqual({ name: 'webapp', ref: 'feat/sso' }));
```

- [ ] **Step 2: → FAIL** · **Step 3: implementieren** — Host lowercase, Pfad unverändert, Port fällt weg, `.git` und abschließender `/` fallen weg. · **Step 4: → PASS**

- [ ] **Step 5: Commit** — `feat(core): Namensregeln und Normalisierung von Repo-URLs`

---

### Task 5: Entitäts- und Config-Schemas

**Files:**
- Create: `src/core/schemas.ts`, `scripts/gen-schemas.ts`, `schemas/backlog.schema.json`, `schemas/user-config.schema.json`, `schemas/project-config.schema.json` (generiert)
- Test: `src/core/schemas.test.ts`

**Interfaces:**
- Consumes: Task 2–4
- Produces:
  - `type EntityKind = 'issue' | 'comment' | 'user' | 'project' | 'sprint' | 'repo'`
  - zod-Schemas `IssueSchema`, `CommentSchema`, `UserSchema`, `ProjectSchema`, `SprintSchema`, `RepoSchema`, `BacklogConfigSchema`, `UserConfigSchema`, `ProjectConfigSchema` und die zugehörigen Typen (`Issue`, `Comment`, …)
  - `KEY_ORDER: Readonly<Record<EntityKind, readonly string[]>>` — Reihenfolge der Schema-Definition, Basis der kanonischen Serialisierung
  - `validateEntity(kind: EntityKind, data: unknown, file: string): { data: object; unknownKeys: string[] }` — wirft `BackeError('validation')` mit `file` und Feldpfad in der Message

Felder und Regeln exakt nach `backe.md` §2.4 (Issue), §2.7 (Kommentar), §2.9 (Projekt), §2.10 (Sprint), §2.11 (Repo), §2.12 (User), §2.15 (Configs). Zeitstempel als String `YYYY-MM-DDTHH:MM:SSZ`, Sprint-Daten als `YYYY-MM-DD`. Defaults von `BacklogConfigSchema`: `workflow.strict: false`, `sync: { mode: 'auto', remote: 'origin', branch: 'main', pull_interval: 60 }`, `verify: 'strict'`, `attachments: { max_bytes: 10485760, lfs: false }`, `props_strict: false`, `props: {}`. `ProjectConfigSchema` kennt `user` nur in der Variante für `.backlog.local.jsonc` (`ProjectLocalConfigSchema`).

- [ ] **Step 1: Failing Tests** — je Regel ein Fall, mindestens:

```ts
const base = { id: 'bk-7f3k2', title: 'T', state: 'todo', creator: 'spw', created: '2026-11-18T10:04:00Z' };
test('minimal issue is valid', () => expect(validateEntity('issue', base, 'f').unknownKeys).toEqual([]));
test.each([
  [{ ...base, state: 'blocked' }, 'blocked_by'],                           // blocked ohne blocked_by
  [{ ...base, blocked_by: ['bk-a91c0'] }, 'blocked_by'],                    // blocked_by ohne blocked
  [{ ...base, state: 'blocked', blocked_by: ['bk-7f3k2'], paused_from: 'todo' }, 'blocked_by'], // eigene ID
  [{ ...base, depends_on: ['bk-7f3k2'] }, 'depends_on'],
  [{ ...base, parent: 'bk-7f3k2' }, 'parent'],
  [{ ...base, title: 'a\nb' }, 'title'],
  [{ ...base, title: '🐉'.repeat(201) }, 'title'],                          // 201 Codepoints
  [{ ...base, attachments: [{ name: 'a', file: 'a', url: 'https://x' }] }, 'attachments'],
  [{ ...base, attachments: [{ name: 'a', file: 'a' }, { name: 'a', url: 'https://x' }] }, 'attachments'],
  [{ ...base, props: { Bad: 1 } }, 'props'],
  [{ ...base, created: '2026-11-18 10:04' }, 'created'],
])('rejects %o at %s', (data, field) => {
  expect(catchErr(() => validateEntity('issue', data, 'issue.md')).message).toContain(field);
});
test('200 code points of emoji are fine', () =>
  expect(() => validateEntity('issue', { ...base, title: '🐉'.repeat(200) }, 'f')).not.toThrow());
test('unknown top-level keys are reported, not dropped', () =>
  expect(validateEntity('issue', { ...base, custom: 1 }, 'f').unknownKeys).toEqual(['custom']));
test('agent user requires operator', () =>
  expect(catchErr(() => validateEntity('user', { name: 'C', kind: 'agent', keys: ['ssh-ed25519 AAAA x'] }, 'f')).message).toContain('operator'));
test('only ssh-ed25519 keys', () =>
  expect(catchErr(() => validateEntity('user', { name: 'S', kind: 'human', keys: ['ssh-rsa AAAA x'] }, 'f')).message).toContain('keys'));
test('backlog config defaults', () =>
  expect(BacklogConfigSchema.parse({ version: 1, name: 'acme', id_prefix: 'bk', admins: ['spw'] }).sync.pull_interval).toBe(60));
test('user only in local project config', () =>
  expect(ProjectConfigSchema.safeParse({ backlog: 'acme', user: 'spw' }).success).toBe(false));
test('generated JSON schemas are up to date', async () => {
  for (const [file, schema] of SCHEMA_FILES) expect(await readJson(`schemas/${file}`)).toEqual(z.toJSONSchema(schema));
});
```

`SCHEMA_FILES` exportiert `scripts/gen-schemas.ts` (Liste Dateiname → Schema); das Script schreibt sie mit `pnpm gen:schemas`.

- [ ] **Step 2: → FAIL** · **Step 3: implementieren, `pnpm gen:schemas` ausführen** · **Step 4: → PASS**

- [ ] **Step 5: Commit** — `feat(core): zod-Schemas für Entitäten und Configs samt JSON Schemas`

---

### Task 6: YAML-Subset und kanonische Serialisierung

**Files:**
- Create: `src/store/frontmatter.ts`
- Test: `src/store/frontmatter.test.ts`

**Interfaces:**
- Consumes: `KEY_ORDER`, `EntityKind` (Task 5), `BackeError` (Task 2)
- Produces:
  - `parseEntityFile(text: string, file: string): { data: Record<string, unknown>; body: string }`
  - `serializeEntityFile(kind: EntityKind, data: Record<string, unknown>, body: string): string`

Regeln: `backe.md` §2.3 und die Planentscheidungen M1 des Gesamtplans. Parsen über `yaml` (`parseDocument`, YAML 1.2 Core-Schema — Zeitstempel bleiben Strings) und einen Walk über den AST, der Anchors, Aliase, Tags, mehrere Dokumente und Kommentare mit `file:line` ablehnt. Frontmatter beginnt mit `---` in Zeile 1 und endet an der nächsten Zeile, die genau `---` ist; alles danach ist Body. BOM wird entfernt, CRLF beim Parsen zu LF.

Kanonisch: Keys in `KEY_ORDER[kind]`, dann unbekannte Keys in Originalreihenfolge, dann `props` als Block-Map mit alphabetisch sortierten Keys. Listen als Flow-Sequenz, wenn die Zeile `key: [..]` ≤ 100 Zeichen bleibt, sonst Block. Listen von Maps (`attachments`, `revoked_keys`) als Block-Sequenz mit Flow-Maps. Leere Listen und leere `props` entfallen. Datei = `---\n` + YAML + `---\n` + Body; ein nicht leerer Body endet mit genau einem `\n`.

- [ ] **Step 1: Failing Tests**

```ts
const issueFile = readFixture('issue.md');   // das Beispiel aus backe.md §2.4, wörtlich
test('spec example is canonical (byte-identical roundtrip)', () => {
  const { data, body } = parseEntityFile(issueFile, 'issue.md');
  expect(serializeEntityFile('issue', data, body)).toBe(issueFile);
});
test('canonical output is idempotent (property)', () => {
  fc.assert(fc.property(arbIssueData(), fc.string(), (data, body) => {
    const once = serializeEntityFile('issue', data, body);
    const p = parseEntityFile(once, 'f');
    expect(p.data).toEqual(data);
    expect(serializeEntityFile('issue', p.data, p.body)).toBe(once);
  }));
});
test.each(['true', 'null', '~', '0x1f', '1e3', '.inf', '4', 'a: b', '[x]', '- x', '* x', '&a', '!x', '# x', 'yes', '2026-11-18'])
('canonical roundtrip keeps ambiguous strings: %s', (s) => {
  const data = { ...minimalIssue, title: s, props: { v: s } };
  expect(parseEntityFile(serializeEntityFile('issue', data, ''), 'f').data).toEqual(data);
});
test('tolerates hand-edited file edges', () => {
  const crlf = '﻿---\r\nid: bk-7f3k2\r\n---\r\nText\r\n\r\n---\r\nmehr';
  const { body } = parseEntityFile(crlf, 'f');
  expect(body).toBe('Text\n\n---\nmehr');            // --- im Body bleibt Body
  expect(serializeEntityFile('issue', minimalIssue, body).endsWith('mehr\n')).toBe(true);
  expect(parseEntityFile('---\nid: bk-7f3k2\n---\n', 'f').body).toBe('');
});
test.each([
  ['anchor', 'x: &a 1\n'], ['alias', 'x: &a 1\ny: *a\n'], ['tag', 'x: !!str 1\n'], ['comment', 'x: 1 # c\n'],
])('rejects %s with file:line', (_, yaml) => {
  const err = catchErr(() => parseEntityFile(`---\nid: bk-7f3k2\n${yaml}---\n`, 'issues/7f/bk-7f3k2/issue.md'));
  expect(err.code).toBe('validation');
  expect(err.message).toMatch(/issues\/7f\/bk-7f3k2\/issue\.md:\d+/);
});
test('missing frontmatter fence is a validation error', () =>
  expect(catchErr(() => parseEntityFile('Nur Text', 'f')).code).toBe('validation'));
test('unknown keys go after known keys, props stay last', () => {
  const out = serializeEntityFile('issue', { ...minimalIssue, zeta: 1, props: { b: 1, a: 2 } }, '');
  expect(out).toMatch(/created: .*\nzeta: 1\nprops:\n  a: 2\n  b: 1\n---\n$/);
});
test('long lists switch to block style', () => {
  const projects = Array.from({ length: 12 }, (_, i) => `project-number-${i}`);
  expect(serializeEntityFile('issue', { ...minimalIssue, projects }, '')).toContain('projects:\n  - project-number-0\n');
});
```

`arbIssueData()` (fast-check-Arbitrary in `test/helpers/arbitraries.ts`) erzeugt gültige Issue-Frontmatter inklusive verschachtelter `props` mit beliebigen Strings — genau dort fallen Quoting-Fehler auf. Die Fixture `test/fixtures/issue.md` ist das Beispiel aus §2.4 (mit ausgeschriebener Figma-URL statt `…`).

- [ ] **Step 2: → FAIL** · **Step 3: implementieren** · **Step 4: → PASS**

- [ ] **Step 5: Commit** — `feat(store): YAML-Subset-Parser und kanonischer Serializer`

---

### Task 7: Layout, Laden und Schreiben

**Files:**
- Create: `src/store/layout.ts`, `src/store/snapshot.ts`, `src/store/files.ts`, `src/store/jsonc.ts`
- Test: `src/store/layout.test.ts`, `src/store/snapshot.test.ts`, `src/store/files.test.ts`

**Interfaces:**
- Consumes: Task 2 (`shardOf`), Task 5 (`validateEntity`, Schemas), Task 6
- Produces:
  - Layout (relativ zur Backlog-Wurzel): `BACKLOG_CONFIG = '.backe/backlog.jsonc'`, `QUARANTINE = '.backe/quarantine.jsonc'`, `issueDir(id)`, `issueFile(id)`, `commentsDir(id)`, `commentFileName(created: string, author: string, rnd: string)` (`20261118T100400Z-spw-q8x.md`), `attachmentsDir(id)`, `userFile(handle)`, `projectFile(path)`, `sprintFile(slug)`, `repoFile(name)`, `localStateDir = '.git/backe'`
  - `type StoredEntity<T> = { data: T; body: string; unknownKeys: string[]; path: string }`
  - `type Problem = { path: string; message: string }`
  - `type BacklogSnapshot = { config: BacklogConfig; users: Map<string, StoredEntity<User>>; projects: Map<string, StoredEntity<Project>>; sprints: Map<string, StoredEntity<Sprint>>; repos: Map<string, StoredEntity<Repo>>; issues: Map<string, StoredEntity<Issue>>; problems: Problem[] }`
  - `loadSnapshot(root: string): Promise<BacklogSnapshot>` — Kommentare und Anhänge werden nicht geladen
  - `listComments(root: string, id: string): Promise<StoredEntity<Comment>[]>` — chronologisch nach Dateiname
  - `listIssueIds(root: string, shard?: string): Promise<string[]>`
  - `readJsonc(text: string, file: string): unknown` — Syntaxfehler → `BackeError('validation')` mit `file:line`
  - `type FileChange = { path: string; content: string | Uint8Array | null }` (`null` = löschen)
  - `applyFileChanges(root: string, changes: readonly FileChange[]): Promise<void>` — jede Datei per Temp-Datei + `rename`; leer gewordene Verzeichnisse unter `issues/`, `projects/` werden entfernt

- [ ] **Step 1: Failing Tests** — Fixture-Backlog unter `test/fixtures/backlog-basic/` mit Config, zwei Users, Projekt `web` und `web/auth`, Sprint, Repo, drei Issues in zwei Shards, einem Kommentar.

```ts
test('layout paths', () => {
  expect(issueFile('bk-7f3k2')).toBe('issues/7f/bk-7f3k2/issue.md');
  expect(projectFile('web/auth')).toBe('projects/web/auth.md');
  expect(commentFileName('2026-11-18T10:04:00Z', 'spw', 'q8x')).toBe('20261118T100400Z-spw-q8x.md');
});
test('loadSnapshot reads every entity kind', async () => {
  const s = await loadSnapshot(fixture('backlog-basic'));
  expect([...s.issues.keys()].sort()).toEqual(['bk-7f3k2', 'bk-a91c0', 'bk-x2c8d']);
  expect(s.projects.has('web/auth')).toBe(true);
  expect(s.config.id_prefix).toBe('bk');
  expect(s.problems).toEqual([]);
});
test('loadSnapshot reports broken files as problems', async () => {
  const root = await copyFixture('backlog-basic');
  await writeFile(join(root, issueFile('bk-a91c0')), '---\nid: [\n---\n');
  const s = await loadSnapshot(root);
  expect(s.issues.has('bk-a91c0')).toBe(false);
  expect(s.issues.size).toBe(2);
  expect(s.problems).toEqual([{ path: 'issues/a9/bk-a91c0/issue.md', message: expect.stringMatching(/issue\.md:\d+/) }]);
});
test('issue id must match its directory', async () => { /* id im Frontmatter ≠ Verzeichnis → Problem */ });
test('unknown keys survive a load/serialize cycle and are listed', async () => {
  const s = await loadSnapshot(fixture('backlog-unknown-key'));
  expect(s.issues.get('bk-7f3k2')!.unknownKeys).toEqual(['legacy']);
});
test('listIssueIds by shard', async () =>
  expect(await listIssueIds(fixture('backlog-basic'), '7f')).toEqual(['bk-7f3k2']));
test('applyFileChanges writes, deletes and prunes empty dirs', async () => {
  const root = await copyFixture('backlog-basic');
  await applyFileChanges(root, [{ path: issueFile('bk-a91c0'), content: null }, { path: 'repos/new.md', content: '---\nurl: gh:a/b\n---\n' }]);
  expect(existsSync(join(root, 'issues/a9'))).toBe(false);
  expect(await readFile(join(root, 'repos/new.md'), 'utf8')).toContain('gh:a/b');
});
test('readJsonc reports syntax errors with line', () =>
  expect(catchErr(() => readJsonc('{\n  "a": ,\n}', 'x.jsonc')).message).toContain('x.jsonc:2'));
```

- [ ] **Step 2: → FAIL** · **Step 3: implementieren** · **Step 4: `mise run check` → PASS inkl. Coverage-Gate für `src/core/**` und `src/store/**`**

- [ ] **Step 5: Commit** — `feat(store): Layout, Snapshot-Laden und atomares Schreiben`

---

## Abnahme M1

- [ ] `mise run check` lokal grün, CI grün auf `ubuntu-latest` und `macos-latest`.
- [ ] Jeder Export aus »Produziert« im Gesamtplan, Abschnitt M1, existiert mit der hier festgelegten Signatur.
- [ ] Danach: Detailplan M2 schreiben, gegen den gebauten Code.
