# backe M3 — Configs und Kontext (`context`, `git/exec`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeder Aufruf von `backe` weiß, in welchem Backlog, als wer, in welchem Projekt, Sprint und Repo er arbeitet — samt Quelle jedes Werts —, und die User-Config lässt sich lesen und kommentarerhaltend ändern.

**Architecture:** `src/git/exec.ts` und `src/git/query.ts` sind der dünne Wrapper um das System-`git` (nur `core` darunter). `src/context/` liegt über `core`, `store` und diesen beiden Git-Dateien: Pfade und Homes, Datei-Lock, User-Config, Projekt-Config-Suche, Backlog-Registry und die Auflösung selbst. Die Auflösung läuft in fester Reihenfolge: Backlog-Name → User → eigene Arbeitskopie und Lese-Wurzel → Projekt, Sprint → Repo. Die Arbeitskopie hängt am Handle (`backe.md` §2.16.1), das Repo an der Registry im Backlog.

**Tech Stack:** wie M2; neu `node:child_process` (`spawn`) nur in `src/git/exec.ts`, `jsonc-parser` (`modify`, `applyEdits`) in `src/context/user-config.ts`.

**Spec:** `docs/proposals/backe.md` (§2.11, §2.12, §2.14, §2.15, §2.16.1, §2.20, §5), Gesamtplan `docs/superpowers/plans/2026-11-18-backe-gesamtplan.md`. Die Global Constraints, die Abschnitte »Übernommen aus M1« (Zeile M3) und die Planentscheidungen mit Meilenstein M3 des Gesamtplans gelten hier; die Tasks wiederholen die Werte, die sie brauchen.

## Global Constraints

Alle Global Constraints des Gesamtplans, von M1 und M2, dazu für M3:

- Schichten: `src/git/exec.ts` und `src/git/query.ts` importieren nur `core` und `node:*`. `src/context/**` importiert `core`, `store`, `git/exec.ts`, `git/query.ts` — nie `ops`, `services`, `cli`, `mcp`.
- `child_process` nur in `src/git/exec.ts`. Die globale Git-Config wird nie verändert, auch nicht in Tests.
- Kein Lesen außerhalb dessen, was die Eingabe nennt: `resolveContext` liest `HOME` und `BACKE_*` aus `input.env`, nie aus `process.env`; `os.homedir()` nur, wenn `input.env.HOME` fehlt. Tests setzen `HOME` immer auf ein Temp-Verzeichnis.
- Fehler: kaputte Config-Datei → `validation` mit `datei:zeile` oder Key-Pfad; unauflösbarer Wert aus einer Quelle → `usage` mit Name der Quelle; unbekannter Backlog-Name → `not_found`; Lock nicht zu bekommen → `conflict`; Git-Fehler → `unexpected` mit `details: {args, exitCode, stderr}`.
- Warten nur über `setTimeout`-Polling oder Promises, nie Busy-Loops; Tests steuern Nebenläufigkeit über Promises und Optionen, nicht über Last.
- Coverage-Gate `src/context/**`: `lines: 90, branches: 90` (Task 3 trägt es ein).

## Review Focus

1. **Symlinks und `~` in Pfaden** — Arbeitsverzeichnis hinter einem Symlink (macOS `/tmp` → `/private/tmp`), relatives oder `~`-haltiges `BACKE_HOME`, `~` in `paths`/`key`/`repos` der User-Config: Kontext und Repo-Zuordnung sind dieselben wie ohne Symlink. → Task 3 `expandPath`/`physicalPath`, Task 5 `symlinked cwd finds the same config`, Task 8 `repo context through a symlinked checkout`.
2. **Leere Umgebungsvariablen** — `BACKE_USER= backe …` oder ein leeres `BACKE_BACKLOG` aus einem Skript: zählt als nicht gesetzt, die nächste Quelle greift. Ein leerer Flag-Wert dagegen ist ein Usage-Fehler. → Task 7 und 8, `empty env vars count as unset`.
3. **Hand-editierte User-Config** — Kommentare, Trailing Commas, eigene Einrückung: `updateUserConfig` ändert nur die betroffene Stelle, der Rest bleibt byte-identisch; ein Tippfehler-Key ergibt `validation` mit Key-Pfad, und es wird nichts geschrieben. → Task 4.
4. **Zwei Prozesse ändern die User-Config gleichzeitig** (zwei `user create-agent`) — keiner verliert seinen Eintrag; ein verwaister Lock eines toten Prozesses blockiert nicht. → Task 3 `withFileLock`, Task 4 `concurrent updates keep both entries`.
5. **Arbeitsverzeichnis ohne Git oder in einem Backlog neuerer Formatversion** — `/`, `$HOME` oder ein Verzeichnis ohne Repo: kein Fehler, Repo-Kontext leer; ein Backlog-Repo mit `version: 2` und unbekannten Keys in `.backe/backlog.jsonc`: der Name wird trotzdem aufgelöst (gelesen wird nur `name`). → Task 7 `backlog repo with a newer format still resolves`, Task 8 `no git repo means no repo context`.

---

## Auflösungsregeln

Gilt für Tasks 6–8. `env`-Werte, die leer sind, zählen als nicht gesetzt. Eine Ebene der Projekt-Config ist das erste Verzeichnis von `physicalPath(cwd)` aufwärts bis `/`, das `.backlog.local.jsonc` oder `.backlog.jsonc` enthält; in ihr gewinnt `.backlog.local.jsonc` je Key.

| Wert | Quellen, erster Treffer gewinnt | `Source.kind` |
| --- | --- | --- |
| backlog | `flags.backlog` → `BACKE_BACKLOG` → Git-Toplevel von `cwd` enthält `.backe/backlog.jsonc` → `backlog` der Projekt-Config-Ebene → `current` der User-Config → `usage`-Fehler | `flag`, `env`, `backlog-repo`, `project-local`/`project`, `user-current` |
| user | `flags.as` → `BACKE_USER` → `user` in `.backlog.local.jsonc` → `backlogs.<b>.user` → `user` (global) | `flag`, `env`, `project-local`, `user-backlog`, `user-default`; sonst `none` |
| project, sprint | `flags.*` → `BACKE_PROJECT`/`BACKE_SPRINT` → `.backlog.local.jsonc` → `.backlog.jsonc` → `backlogs.<b>.*` → global | wie user, plus `project` |
| repo | `repo` der Projekt-Config-Ebene (`null` schaltet ab) → Remote des Git-Repos von `cwd`, dessen kanonische URL in `repos/` des Backlogs steht | `project-local`/`project`, `remote`; sonst `none` |

**Backlog-Werte aus Flag, Env und Projekt-Config** werden so gelesen: passt `BACKLOG_NAME_RE` → Name; beginnt mit `/`, `./`, `../`, `~` oder ist `.`/`..` → Pfad (nur aus Flag und Env; in der Projekt-Config ist ein `/…`-Wert eine `file:`-URL); sonst `normalizeRepoUrl` → URL; sonst `usage`.

- **Name** braucht einen Eintrag `backlogs.<name>`, sonst `not_found` mit Hint `backe backlog list`.
- **URL** wird über `backlogs.*.remote` (kanonisch verglichen) zum Namen; kein Treffer → `not_found` mit Hint `backe backlog clone <url>` (§2.15.2).
- **Pfad** und Stufe 3 binden die Arbeitskopie direkt: `root` und `workingCopy` sind der Git-Toplevel; der Name kommt aus `.backe/backlog.jsonc`, ein Eintrag in der User-Config ist nicht nötig. Kein Backlog dort → `not_found`.

**Arbeitskopie und Lese-Wurzel** (Name-basierte Stufen): `workingCopy` = `backlogs.<b>.paths.<handle>` (expandiert) oder `<BACKE_HOME>/backlogs/<b>/<handle>`, nur wenn ein Handle aufgelöst ist. `root` = `workingCopy`, wenn dort `.backe/backlog.jsonc` liegt; sonst die erste vorhandene andere Arbeitskopie desselben Backlogs (`paths` nach Handle sortiert, dann `<BACKE_HOME>/backlogs/<b>/*` sortiert); sonst `undefined` (M4 klont). Nennt die Config unter `root` einen anderen Namen → `validation` mit beiden Namen.

---

### Task 1: Config-Schemas aus den M1-Reviews

**Files:**
- Modify: `src/core/names.ts`, `src/core/ids.ts`, `src/core/schemas.ts`, `scripts/gen-schemas.ts`, `schemas/*.json`
- Create: `schemas/project-local-config.schema.json` (generiert)
- Test: `src/core/names.test.ts`, `src/core/schemas.test.ts`

**Interfaces:**
- Produces:
  - `names.ts` exportiert `HANDLE_PATTERN = /^(?!me$)[a-z0-9][a-z0-9-]{1,31}$/` und `PROJECT_PATH_RE = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,4}$/`; `isHandle`/`isProjectPath` nutzen sie (Verhalten unverändert). `ids.ts` exportiert `PREFIX_RE`.
  - Alle Config-Schemas prüfen per `.regex()` statt `.refine()`, damit die Muster im JSON Schema stehen: `admins[]`, `user`, `identities.*` (Keys), `backlogs.*.user`, `backlogs.*.paths` (Keys) → `HANDLE_PATTERN`; `id_prefix` → `PREFIX_RE`; `props` (Keys) → `PROP_KEY_RE` als `propertyNames`.
  - `UserConfig`: `current` → `BacklogName`; `backlogs.*.remote` → `GitArg` plus Laufzeit-Refine `normalizeRepoUrl` wirft nicht; Keys von `repos` sind kanonisch (Refine `normalizeRepoUrl(k) === k`); neu `project` (`PROJECT_PATH_RE`) und `sprint` (`SPRINT_SLUG_RE`) global und je `backlogs.*` (§2.14 nennt beide Stufen für project und sprint).
  - `ProjectConfig`/`ProjectLocalConfig`: `backlog` → `BacklogName` oder `GitArg` mit Laufzeit-Refine `normalizeRepoUrl`; `project` → `PROJECT_PATH_RE`; `sprint` → `SPRINT_SLUG_RE`; `repo` → `REPO_NAME_RE` oder `null`. Die Regex-Konstanten werden dafür aus `names.ts` exportiert, soweit noch privat.
  - `SCHEMA_FILES` bekommt als vierten Eintrag `['project-local-config.schema.json', ProjectLocalConfigSchema]`.

- [ ] **Step 1: Failing Tests**

```ts
// schemas.test.ts
test.each([
  ['backlog.schema.json', ['properties', 'admins', 'items', 'pattern']],
  ['backlog.schema.json', ['properties', 'id_prefix', 'pattern']],
  ['backlog.schema.json', ['properties', 'props', 'propertyNames', 'pattern']],
  ['user-config.schema.json', ['properties', 'user', 'pattern']],
  ['user-config.schema.json', ['properties', 'current', 'pattern']],
  ['project-config.schema.json', ['properties', 'project', 'pattern']],
  ['project-local-config.schema.json', ['properties', 'user', 'pattern']],
])('%s carries a pattern at %j', async (file, path) => {
  const schema = JSON.parse(await readFile(`schemas/${file}`, 'utf8'));
  expect(path.reduce((o, k) => o?.[k], schema)).toBeTypeOf('string');
});
test('the handle pattern in the JSON schema rejects the reserved handle', async () => {
  const schema = JSON.parse(await readFile('schemas/user-config.schema.json', 'utf8'));
  const re = new RegExp(schema.properties.user.pattern, 'u');
  expect(re.test('spw')).toBe(true);
  expect(re.test('me')).toBe(false);
});
test.each([
  { current: 'Acme' },
  { backlogs: { acme: { remote: '-x' } } },
  { backlogs: { acme: { remote: 'not a url' } } },
  { repos: { 'git@github.com:acme/webapp.git': '/x' } },
  { project: 'Web' },
  { backlogs: { acme: { sprint: 'w 47' } } },
])('user config rejects %o', (d) => expect(UserConfigSchema.safeParse(d).success).toBe(false));
test('user config accepts project and sprint defaults', () =>
  expect(UserConfigSchema.safeParse({ project: 'web', sprint: 'w47', backlogs: { acme: { project: 'web/auth', sprint: '2026-w47' } } }).success).toBe(true));
test.each([{ project: 'web//auth' }, { sprint: '-x' }, { repo: 'Web App' }, { backlog: 'not a url' }])(
  'project config rejects %o', (d) => expect(ProjectConfigSchema.safeParse(d).success).toBe(false));
test.each([{ backlog: 'acme' }, { backlog: 'git@github.com:acme/backlog.git' }, { repo: null }])(
  'project config accepts %o', (d) => expect(ProjectConfigSchema.safeParse(d).success).toBe(true));
```

Der bestehende Test `generated JSON schemas are up to date` erwartet die vier Dateinamen.

- [ ] **Step 2: `pnpm vitest run src/core` → FAIL**
- [ ] **Step 3: Implementieren**, danach `pnpm gen:schemas`
- [ ] **Step 4: `pnpm vitest run src/core src/store` → PASS**
- [ ] **Step 5: Commit** — `fix(core): Config-Schemas mit Mustern im JSON Schema und strengeren Werten`

---

### Task 2: Git-Wrapper

**Files:**
- Create: `src/git/exec.ts`, `src/git/query.ts`
- Test: `src/git/exec.test.ts`, `src/git/query.test.ts`

**Interfaces:**
- Produces:
  - `type GitOptions = { cwd: string; env?: Readonly<Record<string, string | undefined>>; input?: string; okExitCodes?: readonly number[] }`
  - `type GitResult = { stdout: string; stderr: string; exitCode: number }`
  - `git(args: readonly string[], opts: GitOptions): Promise<GitResult>` — `spawn('git', args, {cwd, env, stdio})`, Ausgabe vollständig gepuffert (kein `maxBuffer`), UTF-8. Env = `process.env`, darüber `opts.env` (`undefined` entfernt den Key), darüber immer `LC_ALL=C` und `GIT_TERMINAL_PROMPT=0`. Exit-Code ≠ 0 und nicht in `okExitCodes` → `BackeError('unexpected', 'git <args[0]> fehlgeschlagen (Exit <n>): <erste stderr-Zeile>', {details: {args, exitCode, stderr}})`. `ENOENT` beim Start → `BackeError('unexpected', 'git nicht gefunden', {hint: 'git installieren; backe doctor prüft die Voraussetzungen.'})`.
  - `gitToplevel(cwd: string): Promise<string | undefined>` — `rev-parse --show-toplevel`; Exit 128 (kein Repo) → `undefined`. Git liefert den physischen Pfad.
  - `gitRemotes(cwd: string): Promise<{ name: string; url: string }[]>` — aus `config --get-regexp ^remote\..*\.url$` (Exit 1 = keine Remotes → `[]`), sortiert: `origin` zuerst, dann nach Name.

- [ ] **Step 1: Failing Tests** (echtes `git` in `tempDir()`; `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_NOSYSTEM` setzt `vitest.config.ts`)

```ts
// exec.test.ts
test('runs git and returns its output', async () => {
  const dir = await tempDir();
  await git(['init', '-q'], { cwd: dir });
  const r = await git(['rev-parse', '--is-inside-work-tree'], { cwd: dir });
  expect(r).toEqual({ stdout: 'true\n', stderr: '', exitCode: 0 });
});
test('a failing command is an unexpected error with details', async () => {
  const err = await catchErrAsync(() => git(['rev-parse', '--verify', 'nope'], { cwd: await tempDir() }));
  expect(err.code).toBe('unexpected');
  expect(err.details).toMatchObject({ args: ['rev-parse', '--verify', 'nope'], exitCode: 128 });
});
test('allowed exit codes are returned, not thrown', async () =>
  expect((await git(['config', '--get', 'x.y'], { cwd: await tempDir(), okExitCodes: [1] })).exitCode).toBe(1));
test('missing git binary has a hint', async () => {
  const err = await catchErrAsync(() => git(['--version'], { cwd: await tempDir(), env: { PATH: '' } }));
  expect(err.message).toBe('git nicht gefunden');
});
test('stdin input reaches git', async () => {
  const dir = await tempDir();
  await git(['init', '-q'], { cwd: dir });
  expect((await git(['hash-object', '--stdin'], { cwd: dir, input: 'x\n' })).stdout).toMatch(/^[0-9a-f]{40}\n$/);
});
test('locale and prompt are forced, undefined removes a variable', async () => {
  // Alias-Name darf kein eingebauter Befehl sein (`show` wäre `git show`).
  const show = (v: string) => ['-c', `alias.printenv-test=!printf %s "\${${v}-unset}"`, 'printenv-test'];
  const cwd = await tempDir();
  expect((await git(show('LC_ALL'), { cwd, env: { LC_ALL: 'de_DE.UTF-8' } })).stdout).toBe('C');
  expect((await git(show('GIT_TERMINAL_PROMPT'), { cwd })).stdout).toBe('0');
  expect((await git(show('HOME'), { cwd, env: { HOME: undefined } })).stdout).toBe('unset');
});

// query.test.ts
test('toplevel of a nested dir, undefined outside a repo', async () => {
  const dir = await realpath(await tempDir());
  await git(['init', '-q'], { cwd: dir });
  await mkdir(join(dir, 'a/b'), { recursive: true });
  expect(await gitToplevel(join(dir, 'a/b'))).toBe(dir);
  expect(await gitToplevel(await tempDir())).toBeUndefined();
});
test('remotes: origin first, then by name', async () => {
  const dir = await tempDir();
  await git(['init', '-q'], { cwd: dir });
  for (const [n, u] of [['zz', 'gh:z/z'], ['origin', 'gh:o/o'], ['aa', 'gh:a/a']]) await git(['remote', 'add', n, u], { cwd: dir });
  expect((await gitRemotes(dir)).map((r) => r.name)).toEqual(['origin', 'aa', 'zz']);
});
```

- [ ] **Step 2: `pnpm vitest run src/git` → FAIL**
- [ ] **Step 3: Implementieren** (nach Interfaces)
- [ ] **Step 4: `pnpm vitest run src/git` → PASS**
- [ ] **Step 5: Commit** — `feat(git): dünner Wrapper um das System-git`

---

### Task 3: Pfade, Homes und Datei-Lock

**Files:**
- Create: `src/context/paths.ts`, `src/context/lock.ts`, `test/helpers/context.ts`
- Modify: `vitest.config.ts` (Threshold `'src/context/**': { lines: 90, branches: 90 }`)
- Test: `src/context/paths.test.ts`, `src/context/lock.test.ts`

**Interfaces:**
- Produces:
  - `type Env = Readonly<Record<string, string | undefined>>`; `type Homes = { home: string; backeHome: string }`
  - `envValue(env: Env, name: string): string | undefined` — leerer String → `undefined`.
  - `expandPath(p: string, opts: { home: string; base: string }): string` — `~` und `~/…` → unter `home`; `~name/…` → `BackeError('usage')`; relativ → `resolve(base, p)`; Ergebnis normalisiert und ohne abschließenden Slash (außer `/`), ohne Dateisystemzugriff.
  - `resolveHomes(env: Env, cwd: string): Homes` — `home` = `envValue(env, 'HOME') ?? os.homedir()`; `backeHome` = `expandPath(BACKE_HOME, {home, base: cwd})`, sonst `<home>/.backe`.
  - `physicalPath(p: string): Promise<string>` — `realpath`; existiert `p` nicht, `realpath` des nächsten existierenden Vorfahren plus der Rest.
  - `samePath(a: string, b: string): Promise<boolean>` — Vergleich der `physicalPath`s.
  - `withFileLock<T>(lockPath: string, fn: () => Promise<T>, opts?: { timeoutMs?: number; retryMs?: number; isAlive?: (pid: number) => boolean }): Promise<T>` — Lock = exklusiv angelegte Datei (`open(…, 'wx')`, Inhalt `<pid>\n<ISO-Zeit>\n`), Elternverzeichnis wird angelegt. Besteht sie: PID lesen; lebt der Prozess nicht (`isAlive`, Default `process.kill(pid, 0)`: `ESRCH` → tot, `EPERM` → lebt), Datei erneut lesen und nur bei unverändertem Inhalt löschen, dann neu versuchen; sonst alle `retryMs` (Default 50) per `setTimeout` neu versuchen bis `timeoutMs` (Default 5000) → `BackeError('conflict', 'Lock <pfad> gehalten von PID <pid>', {hint: 'Läuft noch ein anderer backe-Prozess?'})`. Freigabe im `finally`, auch wenn `fn` wirft. Nicht reentrant. M4 nutzt dieselbe Funktion für `write.lock`.
  - `test/helpers/context.ts`: `contextTree(files?: Record<string, string>): Promise<{ root: string; env: Env; at(rel: string): string }>` — `root` = `realpath` eines `tempDir()`, legt `files` an (Verzeichnisse implizit), `env = { HOME: <root>/home }`; `gitInit(dir: string, remotes?: Record<string, string>): Promise<void>`.

- [ ] **Step 1: Failing Tests**

```ts
// paths.test.ts
const opts = { home: '/h', base: '/w' };
test.each([
  ['~', '/h'], ['~/x', '/h/x'], ['x/../y', '/w/y'], ['/a//b/', '/a/b'], ['./k', '/w/k'],
])('expandPath(%s) = %s', (p, out) => expect(expandPath(p, opts)).toBe(out));
test('~user is not supported', () => expect(catchErr(() => expandPath('~bob/x', opts)).code).toBe('usage'));
test.each([
  [{ HOME: '/h' }, '/w', '/h/.backe'],
  [{ HOME: '/h', BACKE_HOME: '~/b' }, '/w', '/h/b'],
  [{ HOME: '/h', BACKE_HOME: 'rel' }, '/w', '/w/rel'],
  [{ HOME: '/h', BACKE_HOME: '' }, '/w', '/h/.backe'],
])('resolveHomes(%o)', (env, cwd, backeHome) => expect(resolveHomes(env, cwd).backeHome).toBe(backeHome));
test('physicalPath resolves symlinks, also below a missing tail', async () => {
  const { root, at } = await contextTree({ 'real/x': '' });
  await symlink(at('real'), at('link'));
  expect(await physicalPath(at('link/x'))).toBe(at('real/x'));
  expect(await physicalPath(at('link/missing/y'))).toBe(at('real/missing/y'));
  expect(await samePath(at('link'), join(root, 'real'))).toBe(true);
});

// lock.test.ts
test('a second holder waits until the first releases', async () => {
  const lock = join(await tempDir(), 'x.lock');
  const order: string[] = [];
  let release!: () => void;
  const first = withFileLock(lock, () => new Promise<void>((r) => { order.push('a'); release = r; }));
  await vi.waitFor(() => expect(order).toEqual(['a']));
  const second = withFileLock(lock, async () => { order.push('b'); }, { retryMs: 5 });
  release();
  await Promise.all([first, second]);
  expect(order).toEqual(['a', 'b']);
  expect(existsSync(lock)).toBe(false);
});
test('a lock of a dead process is taken over', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, '999999\n2026-01-01T00:00:00Z\n');
  expect(await withFileLock(lock, async () => 42, { isAlive: () => false })).toBe(42);
});
test('a live holder past the timeout is a conflict', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, `${process.pid}\n`);
  expect((await catchErrAsync(() => withFileLock(lock, async () => 1, { timeoutMs: 0 }))).code).toBe('conflict');
});
test('the lock is released when fn throws', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await expect(withFileLock(lock, async () => { throw new Error('x'); })).rejects.toThrow('x');
  expect(existsSync(lock)).toBe(false);
});
```

- [ ] **Step 2: `pnpm vitest run src/context` → FAIL**
- [ ] **Step 3: Implementieren** (nach Interfaces)
- [ ] **Step 4: `pnpm vitest run src/context` → PASS**
- [ ] **Step 5: Commit** — `feat(context): Pfad-Expansion, Homes und Datei-Lock`

---

### Task 4: User-Config lesen und kommentarerhaltend ändern

**Files:**
- Create: `src/context/user-config.ts`
- Modify: `src/store/files.ts` (exportiert `writeFileAtomic(abs: string, content: string | Uint8Array): Promise<void>` — der bisherige private Helfer, unverändert)
- Test: `src/context/user-config.test.ts`

**Interfaces:**
- Consumes: `withFileLock`, `readJsonc`, `UserConfigSchema`
- Produces:
  - `userConfigPath(backeHome: string): string` → `<backeHome>/config.jsonc`
  - `readUserConfig(backeHome: string): Promise<UserConfig>` — fehlende Datei → `{}`; Syntaxfehler → `validation` mit `datei:zeile` (aus `readJsonc`); Schemafehler → `validation`, je Issue eine Zeile `<datei>: <key.pfad>: <message>`.
  - `type ConfigEdit = { path: readonly (string | number)[]; value: unknown }` — `value: undefined` entfernt den Key.
  - `updateUserConfig(backeHome: string, edit: (current: UserConfig) => readonly ConfigEdit[]): Promise<UserConfig>` — unter `withFileLock(<backeHome>/config.lock)`: Text lesen (fehlend → `'{}\n'`), `edit` auf der frisch gelesenen Config aufrufen, Edits per `jsonc-parser` `modify(text, path, value, {formattingOptions: {insertSpaces: true, tabSize: 2, eol: '\n'}})` + `applyEdits` anwenden, Ergebnis mit `readJsonc` + `UserConfigSchema` prüfen (Fehler → nichts geschrieben), dann `writeFileAtomic`. `backeHome` wird mit Modus `0o700` angelegt, falls es fehlt. Gibt die neue Config zurück. Keine Edits → kein Schreiben.

- [ ] **Step 1: Failing Tests**

```ts
const HAND = `{
  // mein Default
  "user": "spw",
  "backlogs": {
    "acme": { "remote": "git@github.com:acme/backlog.git", }, // trailing comma
  },
}
`;
test('missing config reads as empty', async () => expect(await readUserConfig(await tempDir())).toEqual({}));
test('update keeps comments and touches only the changed value', async () => {
  const home = await tempDir();
  await writeFile(userConfigPath(home), HAND);
  await updateUserConfig(home, () => [{ path: ['current'], value: 'acme' }]);
  const text = await readFile(userConfigPath(home), 'utf8');
  expect(text).toContain('// mein Default');
  expect(text).toContain('// trailing comma');
  expect((await readUserConfig(home)).current).toBe('acme');
});
test('undefined removes a key', async () => {
  const home = await tempDir();
  await writeFile(userConfigPath(home), HAND);
  await updateUserConfig(home, () => [{ path: ['user'], value: undefined }]);
  expect((await readUserConfig(home)).user).toBeUndefined();
});
test('an invalid result is rejected and nothing is written', async () => {
  const home = await tempDir();
  await writeFile(userConfigPath(home), HAND);
  const err = await catchErrAsync(() => updateUserConfig(home, () => [{ path: ['user'], value: 'Bad Handle' }]));
  expect(err.code).toBe('validation');
  expect(err.message).toContain('user');
  expect(await readFile(userConfigPath(home), 'utf8')).toBe(HAND);
});
test('a typo key names its path', async () => {
  const home = await tempDir();
  await writeFile(userConfigPath(home), '{ "backlogs": { "acme": { "remte": "x" } } }\n');
  expect((await catchErrAsync(() => readUserConfig(home))).message).toContain('backlogs.acme');
});
test('concurrent updates keep both entries', async () => {
  const home = await tempDir();
  await Promise.all(['a-1', 'a-2'].map((h) =>
    updateUserConfig(home, () => [{ path: ['identities', 'acme', h], value: { key: `/k/${h}` } }])));
  expect(Object.keys((await readUserConfig(home)).identities?.acme ?? {}).sort()).toEqual(['a-1', 'a-2']);
});
test('a fresh home is created private', async () => {
  const home = join(await tempDir(), 'b');
  await updateUserConfig(home, () => [{ path: ['user'], value: 'spw' }]);
  expect((await stat(home)).mode & 0o777).toBe(0o700);
});
```

- [ ] **Step 2: `pnpm vitest run src/context/user-config.test.ts` → FAIL**
- [ ] **Step 3: Implementieren** (nach Interfaces)
- [ ] **Step 4: `pnpm vitest run src/context src/store` → PASS**
- [ ] **Step 5: Commit** — `feat(context): User-Config lesen und kommentarerhaltend ändern`

---

### Task 5: Projekt-Config suchen

**Files:**
- Create: `src/context/project-config.ts`
- Test: `src/context/project-config.test.ts`

**Interfaces:**
- Produces:
  - `type ProjectConfigLevel = { dir: string; local?: { file: string; config: ProjectLocalConfig }; shared?: { file: string; config: ProjectConfig } }` — `file` absolut.
  - `findProjectConfig(cwd: string): Promise<ProjectConfigLevel | undefined>` — von `physicalPath(cwd)` aufwärts bis `/`; die erste Ebene mit mindestens einer der beiden Dateien gewinnt, darüber wird nicht gesucht und nicht gemergt. Nur `ENOENT`/`ENOTDIR` heißen »keine Datei«. Schemafehler → `validation` mit Datei und Key-Pfad; `user` in `.backlog.jsonc` → `validation` mit Hint `user gehört in .backlog.local.jsonc (backe.md §2.15.2).`

- [ ] **Step 1: Failing Tests**

```ts
test('nearest level wins, no merge across levels', async () => {
  const { at } = await contextTree({
    '.backlog.jsonc': '{ "backlog": "outer", "sprint": "w1" }',
    'code/.backlog.jsonc': '{ "project": "web" }',
    'code/app/src/.keep': '',
  });
  const level = await findProjectConfig(at('code/app/src'));
  expect(level?.dir).toBe(at('code'));
  expect(level?.shared?.config).toEqual({ project: 'web' });
});
test('local and shared of one level are both returned', async () => {
  const { at } = await contextTree({ 'p/.backlog.jsonc': '{ "project": "web" }', 'p/.backlog.local.jsonc': '{ "user": "spw" }' });
  const level = await findProjectConfig(at('p'));
  expect([level?.shared?.config.project, level?.local?.config.user]).toEqual(['web', 'spw']);
});
test('a level with only the local file counts', async () => {
  const { at } = await contextTree({ 'p/.backlog.local.jsonc': '{ "sprint": "w2" }' });
  expect((await findProjectConfig(at('p')))?.local?.config.sprint).toBe('w2');
});
test('nothing found up to the root', async () => {
  const { at } = await contextTree({ 'a/.keep': '' });
  expect(await findProjectConfig(at('a'))).toBeUndefined();
});
test('symlinked cwd finds the same config as the physical path', async () => {
  const { root, at } = await contextTree({ 'real/.backlog.jsonc': '{ "project": "web" }', 'real/sub/.keep': '' });
  await symlink(at('real/sub'), join(root, 'link'));
  expect((await findProjectConfig(join(root, 'link')))?.dir).toBe(at('real'));
});
test('user in the shared file is rejected with a hint', async () => {
  const { at } = await contextTree({ 'p/.backlog.jsonc': '{ "user": "spw" }' });
  const err = await catchErrAsync(() => findProjectConfig(at('p')));
  expect([err.code, err.hint]).toEqual(['validation', expect.stringContaining('.backlog.local.jsonc')]);
});
test('syntax error names file and line', async () => {
  const { at } = await contextTree({ 'p/.backlog.jsonc': '{\n  "project": \n}' });
  expect((await catchErrAsync(() => findProjectConfig(at('p')))).message).toMatch(/\.backlog\.jsonc:3/);
});
```

Der Test »nothing found up to the root« setzt voraus, dass über dem Temp-Verzeichnis keine `.backlog*.jsonc` liegt; liegt doch eine, ist das ein Fehler der Testumgebung, kein Grund für eine Sonderregel.

- [ ] **Step 2: `pnpm vitest run src/context/project-config.test.ts` → FAIL**
- [ ] **Step 3: Implementieren** (nach Interfaces)
- [ ] **Step 4: `pnpm vitest run src/context` → PASS**
- [ ] **Step 5: Commit** — `feat(context): Projekt-Config aufwärts suchen`

---

### Task 6: Backlog-Registry

**Files:**
- Create: `src/context/registry.ts`
- Test: `src/context/registry.test.ts`

**Interfaces:**
- Consumes: `updateUserConfig`, `expandPath`, `normalizeRepoUrl`
- Produces:
  - `type BacklogEntry = { name: string; remote?: string; user?: string; current: boolean; paths: Readonly<Record<string, string>> }`
  - `listBacklogs(cfg: UserConfig): BacklogEntry[]` — nach Name sortiert; `current` markiert genau den Eintrag aus `cfg.current`.
  - `findBacklogByRemote(cfg: UserConfig, url: string): string | undefined` — kanonischer Vergleich über `normalizeRepoUrl`; `url` nicht normalisierbar → `usage` (Fehler aus `normalizeRepoUrl`).
  - `managedClonePath(homes: Homes, backlog: string, handle: string): string` → `<backeHome>/backlogs/<backlog>/<handle>`
  - `workingCopyPath(cfg: UserConfig, homes: Homes, backlog: string, handle: string): string` — `paths[handle]` expandiert (`~` → `home`, relativ → `backeHome`), sonst `managedClonePath`.
  - `registerBacklog(homes: Homes, entry: { name: string; remote?: string; handle?: string; path?: string }): Promise<UserConfig>` — legt `backlogs.<name>` an oder ergänzt ihn; `path` nur zusammen mit `handle` (sonst `usage`) und wird unter `paths.<handle>` eingetragen; ein vorhandener `remote` mit anderer kanonischer URL → `conflict`; ein anderer Backlog mit derselben kanonischen Remote-URL → `conflict`. Ist `current` nicht gesetzt, wird er auf `name` gesetzt.
  - `useBacklog(homes: Homes, name: string): Promise<UserConfig>` — unbekannt → `not_found` mit Hint `backe backlog list`.
  - `unregisterBacklog(homes: Homes, name: string): Promise<{ config: UserConfig; managedDir: string }>` — entfernt `backlogs.<name>`, setzt `current` zurück, wenn er `name` war; `identities.<name>` und Dateien bleiben (Löschen ist `--purge`, M4); unbekannt → `not_found`.
  - `setIdentity(homes: Homes, backlog: string, handle: string, key: string): Promise<UserConfig>` — setzt `identities.<backlog>.<handle>.key`.

- [ ] **Step 1: Failing Tests**

```ts
const homes = async () => { const r = await tempDir(); return { home: join(r, 'h'), backeHome: join(r, 'b') }; };
test('first registration becomes current, list is sorted', async () => {
  const h = await homes();
  await registerBacklog(h, { name: 'zeta', remote: 'gh:acme/zeta' });
  const cfg = await registerBacklog(h, { name: 'alpha' });
  expect(listBacklogs(cfg).map((b) => [b.name, b.current])).toEqual([['alpha', false], ['zeta', true]]);
});
test('remote lookup is canonical', async () => {
  const cfg = await registerBacklog(await homes(), { name: 'acme', remote: 'git@github.com:acme/backlog.git' });
  expect(findBacklogByRemote(cfg, 'https://github.com/acme/backlog')).toBe('acme');
  expect(findBacklogByRemote(cfg, 'gh:acme/other')).toBeUndefined();
});
test.each([
  [{ name: 'acme', remote: 'gh:acme/other' }, 'conflict'],
  [{ name: 'beta', remote: 'https://github.com/acme/backlog' }, 'conflict'],
  [{ name: 'acme', path: '/x' }, 'usage'],
])('register %o fails with %s', async (entry, code) => {
  const h = await homes();
  await registerBacklog(h, { name: 'acme', remote: 'gh:acme/backlog' });
  expect((await catchErrAsync(() => registerBacklog(h, entry))).code).toBe(code);
});
test('working copy: bound path or managed clone', async () => {
  const h = await homes();
  const cfg = await registerBacklog(h, { name: 'acme', handle: 'spw', path: '~/code/acme' });
  expect(workingCopyPath(cfg, h, 'acme', 'spw')).toBe(join(h.home, 'code/acme'));
  expect(workingCopyPath(cfg, h, 'acme', 'claude-1')).toBe(join(h.backeHome, 'backlogs/acme/claude-1'));
});
test('unregister clears current but keeps identities', async () => {
  const h = await homes();
  await registerBacklog(h, { name: 'acme' });
  await setIdentity(h, 'acme', 'spw', '~/.ssh/id_ed25519.pub');
  const { config, managedDir } = await unregisterBacklog(h, 'acme');
  expect([config.current, config.backlogs?.acme, config.identities?.acme?.spw?.key]).toEqual([undefined, undefined, '~/.ssh/id_ed25519.pub']);
  expect(managedDir).toBe(join(h.backeHome, 'backlogs/acme'));
});
test('use and unregister of an unknown backlog', async () => {
  const h = await homes();
  expect((await catchErrAsync(() => useBacklog(h, 'nope'))).code).toBe('not_found');
  expect((await catchErrAsync(() => unregisterBacklog(h, 'nope'))).code).toBe('not_found');
});
```

- [ ] **Step 2: `pnpm vitest run src/context/registry.test.ts` → FAIL**
- [ ] **Step 3: Implementieren** (nach Interfaces)
- [ ] **Step 4: `pnpm vitest run src/context` → PASS**
- [ ] **Step 5: Commit** — `feat(context): Backlog-Registry in der User-Config`

---

### Task 7: Backlog und User auflösen

**Files:**
- Create: `src/context/resolve.ts`
- Test: `src/context/resolve.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6
- Produces (Task 8 ergänzt project, sprint, repo):
  - `type ContextFlags = { backlog?: string; as?: string; project?: string; sprint?: string }`
  - `type ContextInput = { cwd: string; env: Env; flags: ContextFlags }`
  - `type SourceKind = 'flag' | 'env' | 'backlog-repo' | 'project-local' | 'project' | 'user-backlog' | 'user-default' | 'user-current' | 'remote' | 'none'`
  - `type Source = { kind: SourceKind; detail?: string }` — `detail` nur bei `env` (Name der Variable), `project-local`/`project` (absoluter Pfad der Datei) und `remote` (Name des Remotes); sonst fehlt der Key.
  - `type Resolved<T> = { value: T; source: Source }`
  - `type ResolvedContext = { homes: Homes; userConfig: UserConfig; backlog: Resolved<string> & { root: string | undefined; workingCopy: string | undefined }; user: Resolved<string | undefined> & { key: string | undefined }; project: Resolved<string | undefined>; sprint: Resolved<string | undefined>; repo: Resolved<string | null | undefined> }`
  - `resolveContext(input: ContextInput): Promise<ResolvedContext>` — in diesem Task mit backlog und user nach »Auflösungsregeln«; project, sprint und repo vorerst `{ value: undefined, source: { kind: 'none' } }`. `user.key` = `identities.<backlog>.<handle>.key`, expandiert (`~` → `home`, relativ → `backeHome`); ohne Eintrag `undefined` (darf lesen, nicht schreiben, §2.14). Ein Handle aus einer Quelle, der `isHandle` nicht erfüllt → `usage` mit der Quelle in der Message.
  - `classifyBacklogRef(value: string, allowPath: boolean): { kind: 'name' | 'path' | 'url'; value: string }` — Regeln aus »Auflösungsregeln«; `url` liefert die kanonische Form.
  - `readBacklogName(root: string): Promise<string | undefined>` — liest aus `.backe/backlog.jsonc` nur `name` (fehlende Datei → `undefined`; `name` ungültig → `validation`), damit ein Backlog neuerer Formatversion den Kontext nicht bricht.
  - `requireWriter(ctx: ResolvedContext): { handle: string; key: string; workingCopy: string }` — kein User → `usage` mit Hint `--as <handle>, BACKE_USER oder "user" in <userConfigPath>`; kein Key → `usage` mit Hint `identities.<backlog>.<handle> in <userConfigPath> eintragen oder backe user create-agent`.

- [ ] **Step 1: Failing Tests** — ein Fixture-Baum je Stufe der Rangfolge (§5). Gemeinsames Setup:

```ts
const CFG = `{ "current": "acme", "user": "spw",
  "identities": { "acme": { "spw": { "key": "~/.ssh/id.pub" } } },
  "backlogs": { "acme": { "remote": "gh:acme/backlog", "user": "spw" }, "beta": { "remote": "gh:acme/beta" } } }`;
const BACKLOG = (name: string) => `{ "version": 1, "name": "${name}", "id_prefix": "bk", "admins": ["spw"] }`;
async function setup(extra: Record<string, string> = {}) {
  const t = await contextTree({ 'home/.backe/config.jsonc': CFG, 'work/.keep': '', ...extra });
  return { ...t, run: (flags: ContextFlags = {}, env: Env = {}, cwd = t.at('work')) =>
    resolveContext({ cwd, env: { ...t.env, ...env }, flags }) };
}
```

```ts
test.each<[string, ContextFlags, Env, string, SourceKind]>([
  ['flag beats env', { backlog: 'beta' }, { BACKE_BACKLOG: 'acme' }, 'beta', 'flag'],
  ['env beats current', {}, { BACKE_BACKLOG: 'beta' }, 'beta', 'env'],
  ['current as fallback', {}, {}, 'acme', 'user-current'],
  ['empty env vars count as unset', {}, { BACKE_BACKLOG: '' }, 'acme', 'user-current'],
])('backlog: %s', async (_n, flags, env, name, kind) => {
  const ctx = await (await setup()).run(flags, env);
  expect([ctx.backlog.value, ctx.backlog.source.kind]).toEqual([name, kind]);
});
test('project config level beats current, local beats shared', async () => {
  const s = await setup({ 'work/.backlog.jsonc': '{ "backlog": "acme" }', 'work/.backlog.local.jsonc': '{ "backlog": "beta" }' });
  const ctx = await s.run();
  expect([ctx.backlog.value, ctx.backlog.source]).toEqual(['beta', { kind: 'project-local', detail: s.at('work/.backlog.local.jsonc') }]);
});
test('a backlog URL in the project config maps to the registered name', async () => {
  const s = await setup({ 'work/.backlog.jsonc': '{ "backlog": "https://github.com/acme/beta.git" }' });
  expect((await s.run()).backlog.value).toBe('beta');
});
test('an unregistered backlog URL hints at backlog clone', async () => {
  const s = await setup({ 'work/.backlog.jsonc': '{ "backlog": "gh:acme/unknown" }' });
  const err = await catchErrAsync(() => s.run());
  expect([err.code, err.hint]).toEqual(['not_found', expect.stringContaining('backe backlog clone')]);
});
test('cwd inside a backlog repo binds that working copy', async () => {
  const s = await setup({ 'repo/.backe/backlog.jsonc': BACKLOG('acme'), 'repo/issues/.keep': '' });
  await gitInit(s.at('repo'));
  const ctx = await s.run({}, {}, s.at('repo/issues'));
  expect(ctx.backlog).toMatchObject({ value: 'acme', source: { kind: 'backlog-repo' }, root: s.at('repo'), workingCopy: s.at('repo') });
});
test('backlog repo with a newer format still resolves', async () => {
  const s = await setup({ 'repo/.backe/backlog.jsonc': '{ "version": 2, "name": "acme", "future": true }' });
  await gitInit(s.at('repo'));
  expect((await s.run({}, {}, s.at('repo'))).backlog.value).toBe('acme');
});
test('a path flag binds the working copy without registration', async () => {
  const s = await setup({ 'other/.backe/backlog.jsonc': BACKLOG('gamma') });
  await gitInit(s.at('other'));
  const ctx = await s.run({ backlog: '../other' });
  expect([ctx.backlog.value, ctx.backlog.root]).toEqual(['gamma', s.at('other')]);
});
test.each([
  [{ backlog: 'nope' }, 'not_found'],
  [{ backlog: '' }, 'usage'],
  [{ as: 'Bad' }, 'usage'],
])('flags %o fail with %s', async (flags, code) =>
  expect((await catchErrAsync(async () => (await setup()).run(flags))).code).toBe(code));
test('no backlog anywhere is a usage error with hint', async () => {
  const t = await contextTree({ 'work/.keep': '' });
  const err = await catchErrAsync(() => resolveContext({ cwd: t.at('work'), env: t.env, flags: {} }));
  expect([err.code, err.hint]).toEqual(['usage', expect.stringContaining('backe backlog use')]);
});

test.each<[string, ContextFlags, Env, Record<string, string>, string | undefined, SourceKind]>([
  ['flag', { as: 'claude-1' }, { BACKE_USER: 'x-1' }, {}, 'claude-1', 'flag'],
  ['env', {}, { BACKE_USER: 'x-1' }, {}, 'x-1', 'env'],
  ['local project config', {}, {}, { 'work/.backlog.local.jsonc': '{ "user": "loc" }' }, 'loc', 'project-local'],
  ['backlog entry', {}, {}, {}, 'spw', 'user-backlog'],
  ['global default', { backlog: 'beta' }, {}, {}, 'spw', 'user-default'],
])('user from %s', async (_n, flags, env, files, handle, kind) => {
  const ctx = await (await setup(files)).run(flags, env);
  expect([ctx.user.value, ctx.user.source.kind]).toEqual([handle, kind]);
});
test('identity maps to an expanded key, a handle without identity may only read', async () => {
  const s = await setup();
  const ctx = await s.run();
  expect(ctx.user.key).toBe(join(s.env.HOME!, '.ssh/id.pub'));
  expect(requireWriter(ctx)).toEqual({ handle: 'spw', key: ctx.user.key, workingCopy: join(s.env.HOME!, '.backe/backlogs/acme/spw') });
  const other = await s.run({ as: 'claude-1' });
  expect(other.user.key).toBeUndefined();
  expect((await catchErrAsync(async () => requireWriter(other))).code).toBe('usage');
});
test('read root falls back to another working copy of the same backlog', async () => {
  const s = await setup({ 'home/.backe/backlogs/acme/claude-1/.backe/backlog.jsonc': BACKLOG('acme') });
  const ctx = await s.run();
  expect([ctx.backlog.workingCopy, ctx.backlog.root]).toEqual([
    join(s.env.HOME!, '.backe/backlogs/acme/spw'), join(s.env.HOME!, '.backe/backlogs/acme/claude-1')]);
});
test('a working copy of another backlog is a validation error', async () => {
  const s = await setup({ 'home/.backe/backlogs/acme/spw/.backe/backlog.jsonc': BACKLOG('beta') });
  expect((await catchErrAsync(() => s.run())).code).toBe('validation');
});
```

- [ ] **Step 2: `pnpm vitest run src/context/resolve.test.ts` → FAIL**
- [ ] **Step 3: Implementieren** (nach Interfaces und »Auflösungsregeln«)
- [ ] **Step 4: `pnpm vitest run src/context` → PASS**
- [ ] **Step 5: Commit** — `feat(context): Backlog und Identität mit Quelle auflösen`

---

### Task 8: Projekt, Sprint und Repo auflösen

**Files:**
- Modify: `src/context/resolve.ts`, `src/store/snapshot.ts`
- Test: `src/context/resolve.test.ts`, `src/store/snapshot.test.ts`

**Interfaces:**
- Consumes: Task 7, `gitToplevel`, `gitRemotes`
- Produces:
  - `loadRepoRegistry(root: string): Promise<Map<string, StoredEntity<Repo>>>` in `src/store/snapshot.ts` — lädt nur `repos/` mit denselben Regeln wie `loadSnapshot` (kaputte Dateien fehlen in der Map), ohne die Backlog-Config zu verlangen.
  - `resolveContext` ergänzt project und sprint nach »Auflösungsregeln«; ein Wert, der `isProjectPath`/`isSprintSlug` nicht erfüllt → `usage` mit Quelle (Werte aus Config-Dateien hat das Schema schon geprüft). Ob Projekt oder Sprint im Backlog existieren, prüft der Kontext nicht.
  - repo: `repo` der Projekt-Config-Ebene → Name (`null` → `value: null`); ist `backlog.root` gesetzt und der Name nicht in der Registry → `not_found` mit Hint `backe repo list`. Sonst, wenn `backlog.root` gesetzt ist und `cwd` in einem Git-Repo liegt, dessen Toplevel nicht `backlog.root` ist: die Remotes in der Reihenfolge von `gitRemotes`, je `normalizeRepoUrl` (nicht normalisierbare überspringen); der erste Remote, dessen kanonische URL der kanonischen `url` eines Registry-Eintrags gleicht, liefert `{ value: <name>, source: { kind: 'remote', detail: <remote> } }`. Sonst `{ value: undefined, source: { kind: 'none' } }`.

- [ ] **Step 1: Failing Tests** (Setup aus Task 7; Backlog-Arbeitskopie unter `home/.backe/backlogs/acme/spw` mit `repos/webapp.md`, `url: git@github.com:acme/webapp.git`)

```ts
const WC = 'home/.backe/backlogs/acme/spw';
const REPO = '---\nurl: git@github.com:acme/webapp.git\n---\n';
const withBacklog = (extra: Record<string, string> = {}) =>
  setup({ [`${WC}/.backe/backlog.jsonc`]: BACKLOG('acme'), [`${WC}/repos/webapp.md`]: REPO, ...extra });

test.each<[string, ContextFlags, Env, Record<string, string>, string | undefined, SourceKind]>([
  ['flag', { project: 'web' }, { BACKE_PROJECT: 'api' }, {}, 'web', 'flag'],
  ['env', {}, { BACKE_PROJECT: 'api' }, {}, 'api', 'env'],
  ['local beats shared', {}, {}, { 'work/.backlog.jsonc': '{ "project": "a" }', 'work/.backlog.local.jsonc': '{ "project": "b" }' }, 'b', 'project-local'],
  ['shared', {}, {}, { 'work/.backlog.jsonc': '{ "project": "a" }' }, 'a', 'project'],
  ['empty env vars count as unset', {}, { BACKE_PROJECT: '' }, {}, undefined, 'none'],
])('project from %s', async (_n, flags, env, files, value, kind) => {
  const ctx = await (await setup(files)).run(flags, env);
  expect([ctx.project.value, ctx.project.source.kind]).toEqual([value, kind]);
});
test('sprint from the backlog entry, then the global default', async () => {
  const s = await setup({ 'home/.backe/config.jsonc': CFG.replace('"user": "spw" }', '"user": "spw", "sprint": "w47" }').replace('"current"', '"sprint": "w1", "current"') });
  expect((await s.run()).sprint).toEqual({ value: 'w47', source: { kind: 'user-backlog' } });
  expect((await s.run({ backlog: 'beta' })).sprint).toEqual({ value: 'w1', source: { kind: 'user-default' } });
});
test('invalid project from env names the source', async () => {
  const err = await catchErrAsync(async () => (await setup()).run({}, { BACKE_PROJECT: 'Web' }));
  expect([err.code, err.message]).toEqual(['usage', expect.stringContaining('BACKE_PROJECT')]);
});

test('repo context from a registered remote', async () => {
  const s = await withBacklog({ 'code/webapp/src/.keep': '' });
  await gitInit(s.at('code/webapp'), { upstream: 'https://github.com/acme/webapp' });
  const ctx = await s.run({}, {}, s.at('code/webapp/src'));
  expect(ctx.repo).toEqual({ value: 'webapp', source: { kind: 'remote', detail: 'upstream' } });
});
test('repo context through a symlinked checkout', async () => {
  const s = await withBacklog({ 'code/webapp/.keep': '' });
  await gitInit(s.at('code/webapp'), { origin: 'gh:acme/webapp' });
  await symlink(s.at('code/webapp'), s.at('wa'));
  expect((await s.run({}, {}, s.at('wa'))).repo.value).toBe('webapp');
});
test('repo from the project config, null switches it off', async () => {
  const s = await withBacklog({ 'code/webapp/.backlog.jsonc': '{ "repo": null }' });
  await gitInit(s.at('code/webapp'), { origin: 'gh:acme/webapp' });
  expect((await s.run({}, {}, s.at('code/webapp'))).repo).toEqual({ value: null, source: { kind: 'project', detail: s.at('code/webapp/.backlog.jsonc') } });
});
test('an unknown repo name in the project config is not found', async () => {
  const s = await withBacklog({ 'work/.backlog.jsonc': '{ "repo": "nope" }' });
  expect((await catchErrAsync(() => s.run())).code).toBe('not_found');
});
test('no git repo means no repo context', async () => {
  const s = await withBacklog();
  expect((await s.run()).repo).toEqual({ value: undefined, source: { kind: 'none' } });
});
test('unregistered remote means no repo context', async () => {
  const s = await withBacklog({ 'code/other/.keep': '' });
  await gitInit(s.at('code/other'), { origin: 'gh:acme/other' });
  expect((await s.run({}, {}, s.at('code/other'))).repo.value).toBeUndefined();
});

// snapshot.test.ts
test('loadRepoRegistry loads only repos and skips broken files', async () => {
  const root = await copyFixture('backlog-basic');
  await writeFile(join(root, 'repos/broken.md'), '---\nurl: [\n---\n');
  await rm(join(root, '.backe/backlog.jsonc'));
  expect([...(await loadRepoRegistry(root)).keys()]).toEqual(['webapp']);
});
```

- [ ] **Step 2: `pnpm vitest run src/context src/store/snapshot.test.ts` → FAIL**
- [ ] **Step 3: Implementieren** (nach Interfaces)
- [ ] **Step 4: `mise run check` → grün inklusive Coverage-Gate `src/context/**`**
- [ ] **Step 5: Commit** — `feat(context): Projekt, Sprint und Repo mit Quelle auflösen`

---

## Abnahme M3

- [ ] `mise run check` lokal grün inklusive Coverage-Gate für `src/context/**`; CI grün auf `ubuntu-latest` und `macos-latest` (dort greift der `/tmp` → `/private/tmp`-Fall echt).
- [ ] Jeder Export aus »Produziert« im Gesamtplan, Abschnitt M3, existiert mit der hier festgelegten Signatur (`git`, `resolveContext`, `readUserConfig`/`updateUserConfig`, `expandPath`).
- [ ] `grep -rE "/ops/|/services/|/cli/|/mcp/" src/context src/git` ist leer; `grep -rl "child_process" src` nennt nur `src/git/exec.ts`.
- [ ] Danach: Detailplan M4 schreiben, gegen den gebauten Code.
