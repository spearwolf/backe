/** `backe doctor` (backe.md §2.20): Systemvoraussetzungen, Arbeitskopien und Backlog prüfen; `--fix` räumt nur Temp-Reste. */
import { execFile } from 'node:child_process';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { type Env, expandPath, findOnPath, type Homes, resolveHomes } from '../context/paths.ts';
import { listBacklogs } from '../context/registry.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { readUserConfig } from '../context/user-config.ts';
import { compareCodeUnits } from '../core/compare.ts';
import { BackeError } from '../core/errors.ts';
import type { UserConfig } from '../core/schemas.ts';
import { sshFingerprint } from '../core/ssh.ts';
import { git } from '../git/exec.ts';
import { readLocalState, stateDir } from '../git/local-state.ts';
import { headState } from '../git/repo.ts';
import { readPublicKey } from '../git/ssh.ts';
import { exists } from '../store/files.ts';
import { hasLfsRule, projectFile } from '../store/layout.ts';
import { type BacklogSnapshot, loadSnapshot } from '../store/snapshot.ts';
import { activeFingerprints } from './verify-state.ts';

export type DoctorCheck = {
  id: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  hint?: string;
};

type RunResult = { code: number; stdout: string } | 'missing' | 'timeout';

export type DoctorDeps = {
  now?: () => Date;
  host?: string;
  /** Führt ein Programm aus; `'missing'`, wenn es nicht startet, `'timeout'` nach der Frist. */
  run?: (cmd: string, args: string[]) => Promise<RunResult>;
  isAlive?: (pid: number) => boolean;
  /** Node-Version (Default `process.versions.node`). */
  nodeVersion?: string;
};

export type DoctorInput = {
  env: Env;
  cwd: string;
  /** Fehlt, wenn sich kein Backlog auflösen ließ; `contextError` ist dann die Meldung der Auflösung. */
  ctx?: ResolvedContext;
  contextError?: string;
  fix?: boolean;
};

const MIN_NODE = 26;
const MIN_GIT: readonly [number, number] = [2, 38];
const CLONE_TEMP_MAX_AGE_MS = 3_600_000;
const LOCK_TEMP = /^(?:write|config)\.lock\.(\d+)\.[0-9a-f]{12}$/;

/**
 * Führt Programme für die Werkzeug-Prüfung aus: `cmd` nur aus absoluten `PATH`-Einträgen
 * (`findOnPath`), damit ein `git` im Arbeitsverzeichnis nicht das echte überschattet. Nicht
 * gefunden oder nicht startbar → `'missing'`; nach `timeoutMs` beendet → `'timeout'`.
 */
export function toolRunner(env: Env, timeoutMs = 10_000): NonNullable<DoctorDeps['run']> {
  const merged: Record<string, string> = { LC_ALL: 'C' };
  for (const [key, value] of Object.entries({ ...process.env, ...env })) {
    if (value !== undefined) merged[key] = value;
  }
  return async (cmd, args) => {
    const file = await findOnPath(merged, cmd);
    if (file === undefined) return 'missing';
    return new Promise((done) => {
      execFile(file, args, { env: merged, timeout: timeoutMs }, (error, stdout) => {
        if (error === null) return done({ code: 0, stdout });
        if (error.killed === true) return done('timeout');
        const code = (error as NodeJS.ErrnoException).code;
        done(typeof code === 'number' ? { code, stdout } : 'missing');
      });
    });
  };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const check = (
  id: string,
  status: DoctorCheck['status'],
  detail: string,
  hint?: string,
): DoctorCheck => ({ id, status, detail, ...(hint === undefined ? {} : { hint }) });

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** Verwaltete Klone `<BACKE_HOME>/backlogs/<name>/<handle>`. */
async function managedClones(homes: Homes): Promise<string[]> {
  const base = join(homes.backeHome, 'backlogs');
  const out: string[] = [];
  for (const name of (await listDir(base)).sort()) {
    for (const handle of (await listDir(join(base, name))).sort())
      out.push(join(base, name, handle));
  }
  return out;
}

function boundPaths(
  cfg: UserConfig,
  homes: Homes,
): { backlog: string; handle: string; path: string }[] {
  const out: { backlog: string; handle: string; path: string }[] = [];
  for (const entry of listBacklogs(cfg)) {
    for (const [handle, raw] of Object.entries(entry.paths).sort(([a], [b]) =>
      compareCodeUnits(a, b),
    )) {
      try {
        out.push({
          backlog: entry.name,
          handle,
          path: expandPath(raw, { home: homes.home, base: homes.backeHome }),
        });
      } catch {
        out.push({ backlog: entry.name, handle, path: raw });
      }
    }
  }
  return out;
}

function checkNode(version: string): DoctorCheck {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return major >= MIN_NODE
    ? check('node', 'ok', version)
    : check(
        'node',
        'fail',
        `Node ${version}, benötigt ≥ ${MIN_NODE}`,
        `Node ≥ ${MIN_NODE} installieren`,
      );
}

/** Ein Werkzeug, das nicht rechtzeitig antwortet, ist kaputt, nicht abwesend. */
const timedOut = (id: string, label: string, hint: string): DoctorCheck =>
  check(id, 'fail', `${label}: Zeitüberschreitung`, hint);

async function checkTools(
  run: NonNullable<DoctorDeps['run']>,
  lfsRequired: boolean,
): Promise<DoctorCheck[]> {
  const out: DoctorCheck[] = [];
  const git = await run('git', ['--version']);
  const m = typeof git === 'string' ? null : /git version (\d+)\.(\d+)/.exec(git.stdout);
  if (git === 'missing')
    out.push(check('git', 'fail', 'git nicht gefunden', 'Git ≥ 2.38 installieren'));
  else if (git === 'timeout') out.push(timedOut('git', 'git', 'git --version prüfen'));
  else if (m === null) {
    out.push(
      check(
        'git',
        'fail',
        `Version nicht erkennbar: ${git.stdout.trim()}`,
        'Git ≥ 2.38 installieren',
      ),
    );
  } else {
    const [major, minor] = [Number(m[1]), Number(m[2])];
    const ok = major > MIN_GIT[0] || (major === MIN_GIT[0] && minor >= MIN_GIT[1]);
    out.push(
      ok
        ? check('git', 'ok', `${major}.${minor}`)
        : check('git', 'fail', `Git ${major}.${minor}, benötigt ≥ 2.38`, 'Git ≥ 2.38 installieren'),
    );
  }
  const keygen = await run('ssh-keygen', ['-?']);
  out.push(
    keygen === 'missing'
      ? check('ssh-keygen', 'fail', 'ssh-keygen nicht gefunden', 'OpenSSH installieren')
      : keygen === 'timeout'
        ? timedOut('ssh-keygen', 'ssh-keygen', 'ssh-keygen prüfen')
        : check('ssh-keygen', 'ok', 'vorhanden'),
  );
  const lfs = await run('git', ['lfs', 'version']);
  if (lfs === 'timeout') out.push(timedOut('git-lfs', 'git lfs', 'git lfs version prüfen'));
  else if (lfs !== 'missing' && lfs.code === 0) out.push(check('git-lfs', 'ok', lfs.stdout.trim()));
  else if (lfsRequired) {
    out.push(
      check(
        'git-lfs',
        'fail',
        'git-lfs fehlt, attachments.lfs verlangt es',
        'git-lfs installieren',
      ),
    );
  } else out.push(check('git-lfs', 'warn', 'nicht gefunden (optional)'));
  const gh = await run('gh', ['--version']);
  out.push(
    gh === 'timeout'
      ? timedOut('gh', 'gh', 'gh --version prüfen')
      : gh === 'missing' || gh.code !== 0
        ? check('gh', 'warn', 'nicht gefunden (optional, für repo check --remote)')
        : check('gh', 'ok', gh.stdout.split('\n')[0] ?? 'vorhanden'),
  );
  return out;
}

/** Grund, warum die Arbeitskopie nicht benutzbar ist; `undefined`, wenn alles stimmt. */
async function backlogProblem(
  ctx: ResolvedContext,
  snapshot: BacklogSnapshot | undefined,
  loadError: string | undefined,
): Promise<{ detail: string; hint?: string } | undefined> {
  const root = ctx.backlog.root;
  const name = ctx.backlog.value;
  if (root === undefined) {
    const remote = ctx.userConfig.backlogs?.[name]?.remote;
    return {
      detail: `Keine Arbeitskopie von »${name}« vorhanden`,
      hint:
        remote === undefined ? `backe backlog add ${name} <pfad>` : `backe backlog clone ${remote}`,
    };
  }
  if (snapshot === undefined) return { detail: `Snapshot nicht ladbar: ${loadError}` };
  const problems: string[] = [];
  let hint: string | undefined;
  try {
    const state = await headState(root);
    const wanted = snapshot.config.sync.branch;
    if (state.operation !== undefined) {
      problems.push(`läuft ein ${state.operation}`);
      hint = `git -C ${root} ${state.operation} --abort`;
    } else if (state.branch !== wanted) {
      problems.push(
        state.branch === undefined
          ? 'detached HEAD'
          : `steht auf ${state.branch}, erwartet ${wanted}`,
      );
      hint = `git -C ${root} switch ${wanted}`;
    }
    const journal = join(await stateDir(root, { create: false }), 'write.journal');
    if (await exists(journal)) {
      problems.push('liegengebliebenes write.journal');
      hint ??= `Der nächste Write setzt es zurück; sonst git -C ${root} status prüfen und ${journal} löschen`;
    }
  } catch (error) {
    problems.push(message(error));
  }
  return problems.length === 0
    ? undefined
    : { detail: problems.join('; '), ...(hint === undefined ? {} : { hint }) };
}

async function checkIdentity(
  ctx: ResolvedContext,
  snapshot: BacklogSnapshot,
  root: string,
): Promise<DoctorCheck> {
  const handle = ctx.user.value;
  if (handle === undefined)
    return check('identity', 'warn', 'kein User aufgelöst', '--as <handle> oder BACKE_USER');
  if (ctx.user.key === undefined) {
    return check(
      'identity',
      'warn',
      `für »${handle}« ist kein Signing-Key eingetragen`,
      'backe user create-agent oder identities in der User-Config',
    );
  }
  let line: string;
  try {
    line = await readPublicKey(ctx.user.key);
  } catch (error) {
    return check('identity', 'fail', message(error));
  }
  if (!activeFingerprints(snapshot.users.get(handle)?.data).has(sshFingerprint(line))) {
    return check('identity', 'fail', `Der Key ist kein aktiver Key von »${handle}« im Snapshot`);
  }
  const local = await readLocalState(root, 'identity');
  if (local !== undefined && local !== handle) {
    return check('identity', 'fail', `Die Arbeitskopie gehört »${local}«, nicht »${handle}«`);
  }
  return check('identity', 'ok', handle);
}

async function checkLfsRule(snapshot: BacklogSnapshot, root: string): Promise<DoctorCheck> {
  if (!snapshot.config.attachments.lfs) return check('lfs-rule', 'ok', 'attachments.lfs ist aus');
  if (!hasLfsRule(snapshot.attributes)) {
    return check(
      'lfs-rule',
      'warn',
      'LFS-Regel fehlt in .gitattributes',
      'kommt mit dem nächsten attach add',
    );
  }
  let filter: Awaited<ReturnType<typeof git>>;
  try {
    filter = await git(['config', '--local', '--get', 'filter.lfs.process'], {
      cwd: root,
      okExitCodes: [1],
    });
  } catch (error) {
    return check('lfs-rule', 'warn', message(error));
  }
  return filter.exitCode === 0
    ? check('lfs-rule', 'ok', 'LFS-Regel und lokaler Filter vorhanden')
    : check(
        'lfs-rule',
        'warn',
        'filter.lfs.process fehlt in der lokalen Git-Config',
        'wird beim nächsten Write eingerichtet',
      );
}

async function checkBindings(cfg: UserConfig | undefined, homes: Homes): Promise<DoctorCheck[]> {
  if (cfg === undefined)
    return [check('bindings', 'warn', 'übersprungen, die User-Config ist ungültig')];
  const out: DoctorCheck[] = [];
  for (const { backlog, handle, path } of boundPaths(cfg, homes)) {
    if (await exists(path)) continue;
    out.push(
      check(
        'bindings',
        'warn',
        `${backlog}/${handle}: ${path} existiert nicht`,
        `backe backlog remove ${backlog} oder backe backlog add`,
      ),
    );
  }
  return out.length === 0 ? [check('bindings', 'ok', 'alle gebundenen Pfade existieren')] : out;
}

async function checkAlternates(homes: Homes): Promise<DoctorCheck[]> {
  const out: DoctorCheck[] = [];
  for (const clone of await managedClones(homes)) {
    const objects = join(clone, '.git', 'objects');
    const file = join(objects, 'info', 'alternates');
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n').map((l) => l.trim())) {
      if (line === '' || line.startsWith('#')) continue;
      // Relative Einträge gelten wie bei git relativ zu `objects/`, nicht zu `objects/info/`.
      const target = isAbsolute(line) ? line : resolve(objects, line);
      if (await exists(target)) continue;
      out.push(
        check(
          'alternates',
          'fail',
          `${clone}: ${target} existiert nicht`,
          `git -C ${clone} repack -a -d && rm ${file}`,
        ),
      );
    }
  }
  return out.length === 0 ? [check('alternates', 'ok', 'alle Referenzen existieren')] : out;
}

/** Temp-Reste: alte Clone-Temps und Lock-Temps toter PIDs dieses Hosts. */
async function findLeftovers(
  homes: Homes,
  roots: readonly string[],
  now: Date,
  host: string,
  isAlive: (pid: number) => boolean,
): Promise<string[]> {
  const found: string[] = [];
  const tmp = join(homes.backeHome, 'tmp');
  for (const entry of await listDir(tmp)) {
    if (!entry.startsWith('clone-')) continue;
    const path = join(tmp, entry);
    const info = await stat(path).catch(() => undefined);
    if (info !== undefined && now.getTime() - info.mtimeMs > CLONE_TEMP_MAX_AGE_MS)
      found.push(path);
  }
  const dirs = [homes.backeHome, ...roots.map((wc) => join(wc, '.git', 'backe'))];
  for (const dir of dirs) {
    for (const entry of await listDir(dir)) {
      const pid = Number(LOCK_TEMP.exec(entry)?.[1]);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      const path = join(dir, entry);
      const text = await readFile(path, 'utf8').catch(() => undefined);
      if (text?.split('\n')[2] === host && !isAlive(pid)) found.push(path);
    }
  }
  return found;
}

async function checkTemp(leftovers: string[], fix: boolean): Promise<DoctorCheck> {
  if (leftovers.length === 0) return check('temp', 'ok', 'keine Temp-Reste');
  if (!fix) {
    return check('temp', 'warn', `${leftovers.length} Temp-Reste`, 'backe doctor --fix');
  }
  let removed = 0;
  for (const path of leftovers) {
    try {
      await rm(path, { recursive: true, force: true });
      removed++;
    } catch {
      // bleibt liegen und wird beim nächsten Lauf erneut gemeldet
    }
  }
  return removed === leftovers.length
    ? check('temp', 'ok', `${removed} entfernt`)
    : check('temp', 'warn', `${removed} von ${leftovers.length} entfernt`, 'Rechte prüfen');
}

function checkReferences(snapshot: BacklogSnapshot): DoctorCheck[] {
  const out: DoctorCheck[] = [];
  const byKey = <T>(m: Map<string, T>) => [...m].sort(([a], [b]) => compareCodeUnits(a, b));
  for (const [id, { data }] of byKey(snapshot.issues)) {
    if (data.assignee !== undefined && !snapshot.users.has(data.assignee)) {
      out.push(
        check(
          'references',
          'warn',
          `${id} assignee ${data.assignee}`,
          `backe issue assign ${id} none`,
        ),
      );
    }
  }
  for (const [path, { data }] of byKey(snapshot.projects)) {
    if (data.lead !== undefined && !snapshot.users.has(data.lead)) {
      out.push(
        check(
          'references',
          'warn',
          `${path} lead ${data.lead}`,
          `lead in ${projectFile(path)} entfernen oder den User anlegen`,
        ),
      );
    }
  }
  return out.length === 0 ? [check('references', 'ok', 'alle Verweise zeigen auf Users')] : out;
}

export async function runDoctor(input: DoctorInput, deps: DoctorDeps = {}): Promise<DoctorCheck[]> {
  const { ctx } = input;
  const homes = ctx?.homes ?? resolveHomes(input.env, input.cwd);
  const run = deps.run ?? toolRunner(input.env);
  const now = (deps.now ?? (() => new Date()))();
  const host = deps.host ?? hostname();
  const isAlive = deps.isAlive ?? processAlive;

  const root = ctx?.backlog.root;
  let snapshot: BacklogSnapshot | undefined;
  let loadError: string | undefined;
  if (root !== undefined) {
    try {
      snapshot = await loadSnapshot(root);
    } catch (error) {
      loadError = message(error);
    }
  }

  const checks: DoctorCheck[] = [checkNode(deps.nodeVersion ?? process.versions.node)];
  checks.push(...(await checkTools(run, snapshot?.config.attachments.lfs ?? false)));

  let cfg: UserConfig | undefined;
  try {
    cfg = await readUserConfig(homes.backeHome);
    checks.push(check('user-config', 'ok', 'gültig'));
  } catch (error) {
    checks.push(check('user-config', 'fail', message(error), 'backe config edit'));
  }

  if (ctx === undefined) {
    checks.push(
      check(
        'backlog',
        'warn',
        input.contextError ?? 'Kein Backlog aufgelöst',
        'backe backlog list',
      ),
    );
  } else {
    const problem = await backlogProblem(ctx, snapshot, loadError);
    checks.push(
      problem === undefined
        ? check('backlog', 'ok', `${ctx.backlog.value} in ${root}`)
        : check('backlog', 'fail', problem.detail, problem.hint),
    );
  }
  if (ctx !== undefined && root !== undefined && snapshot !== undefined) {
    try {
      checks.push(await checkIdentity(ctx, snapshot, root));
    } catch (error) {
      checks.push(check('identity', 'fail', message(error)));
    }
    checks.push(await checkLfsRule(snapshot, root));
  }

  checks.push(...(await checkBindings(cfg, homes)));
  checks.push(...(await checkAlternates(homes)));

  const roots = new Set(await managedClones(homes));
  for (const { path } of cfg === undefined ? [] : boundPaths(cfg, homes)) roots.add(path);
  if (root !== undefined) roots.add(root);
  checks.push(
    await checkTemp(await findLeftovers(homes, [...roots], now, host, isAlive), input.fix === true),
  );

  if (snapshot !== undefined) {
    const problems = snapshot.problems.map((p) =>
      check('problems', 'warn', `${p.path}: ${p.message}`),
    );
    checks.push(
      ...(problems.length === 0 ? [check('problems', 'ok', 'keine Problem-Dateien')] : problems),
    );
    checks.push(...checkReferences(snapshot));
  }
  return checks;
}

/** Ein `fail` macht den Lauf zu einem `validation`-Fehler (Exit 2), nachdem der Bericht ausgegeben ist. */
export function doctorFailure(checks: readonly DoctorCheck[]): BackeError | undefined {
  const failed = checks.filter((c) => c.status === 'fail').length;
  return failed === 0
    ? undefined
    : new BackeError('validation', `doctor: ${failed} Prüfung(en) fehlgeschlagen`);
}
