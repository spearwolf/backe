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
import { m } from './doctor.messages.ts';
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
    : check('node', 'fail', m.nodeTooOld(version, MIN_NODE), m.nodeInstallHint(MIN_NODE));
}

/** Ein Werkzeug, das nicht rechtzeitig antwortet, ist kaputt, nicht abwesend. */
const timedOut = (id: string, label: string, hint: string): DoctorCheck =>
  check(id, 'fail', m.timedOut(label), hint);

async function checkTools(
  run: NonNullable<DoctorDeps['run']>,
  lfsRequired: boolean,
): Promise<DoctorCheck[]> {
  const out: DoctorCheck[] = [];
  const git = await run('git', ['--version']);
  const version = typeof git === 'string' ? null : /git version (\d+)\.(\d+)/.exec(git.stdout);
  if (git === 'missing') out.push(check('git', 'fail', m.gitMissing, m.gitInstallHint));
  else if (git === 'timeout') out.push(timedOut('git', 'git', m.gitVersionHint));
  else if (version === null) {
    out.push(check('git', 'fail', m.gitVersionUnknown(git.stdout.trim()), m.gitInstallHint));
  } else {
    const [major, minor] = [Number(version[1]), Number(version[2])];
    const ok = major > MIN_GIT[0] || (major === MIN_GIT[0] && minor >= MIN_GIT[1]);
    out.push(
      ok
        ? check('git', 'ok', `${major}.${minor}`)
        : check('git', 'fail', m.gitTooOld(major, minor), m.gitInstallHint),
    );
  }
  const keygen = await run('ssh-keygen', ['-?']);
  out.push(
    keygen === 'missing'
      ? check('ssh-keygen', 'fail', m.sshKeygenMissing, m.sshKeygenInstallHint)
      : keygen === 'timeout'
        ? timedOut('ssh-keygen', 'ssh-keygen', m.sshKeygenCheckHint)
        : check('ssh-keygen', 'ok', m.present),
  );
  const lfs = await run('git', ['lfs', 'version']);
  if (lfs === 'timeout') out.push(timedOut('git-lfs', 'git lfs', m.gitLfsVersionHint));
  else if (lfs !== 'missing' && lfs.code === 0) out.push(check('git-lfs', 'ok', lfs.stdout.trim()));
  else if (lfsRequired) {
    out.push(check('git-lfs', 'fail', m.gitLfsRequired, m.gitLfsInstallHint));
  } else out.push(check('git-lfs', 'warn', m.gitLfsOptionalMissing));
  const gh = await run('gh', ['--version']);
  out.push(
    gh === 'timeout'
      ? timedOut('gh', 'gh', m.ghVersionHint)
      : gh === 'missing' || gh.code !== 0
        ? check('gh', 'warn', m.ghOptionalMissing)
        : check('gh', 'ok', gh.stdout.split('\n')[0] ?? m.present),
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
      detail: m.noWorkingCopy(name),
      hint: remote === undefined ? m.addBacklogHint(name) : m.cloneBacklogHint(remote),
    };
  }
  if (snapshot === undefined) return { detail: m.snapshotNotLoadable(loadError as string) };
  const problems: string[] = [];
  let hint: string | undefined;
  try {
    const state = await headState(root);
    const wanted = snapshot.config.sync.branch;
    if (state.operation !== undefined) {
      problems.push(m.operationRunning(state.operation));
      hint = `git -C ${root} ${state.operation} --abort`;
    } else if (state.branch !== wanted) {
      problems.push(
        state.branch === undefined ? 'detached HEAD' : m.onWrongBranch(state.branch, wanted),
      );
      hint = `git -C ${root} switch ${wanted}`;
    }
    const journal = join(await stateDir(root, { create: false }), 'write.journal');
    if (await exists(journal)) {
      problems.push(m.staleJournal);
      hint ??= m.staleJournalHint(root, journal);
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
    return check('identity', 'warn', m.noUserResolved, m.noUserResolvedHint('--as'));
  if (ctx.user.key === undefined) {
    return check('identity', 'warn', m.noSigningKey(handle), m.noSigningKeyHint);
  }
  let line: string;
  try {
    line = await readPublicKey(ctx.user.key);
  } catch (error) {
    return check('identity', 'fail', message(error));
  }
  if (!activeFingerprints(snapshot.users.get(handle)?.data).has(sshFingerprint(line))) {
    return check('identity', 'fail', m.keyNotActive(handle));
  }
  const local = await readLocalState(root, 'identity');
  if (local !== undefined && local !== handle) {
    return check('identity', 'fail', m.workingCopyOfOther(local, handle));
  }
  return check('identity', 'ok', handle);
}

async function checkLfsRule(snapshot: BacklogSnapshot, root: string): Promise<DoctorCheck> {
  if (!snapshot.config.attachments.lfs) return check('lfs-rule', 'ok', m.lfsOff);
  if (!hasLfsRule(snapshot.attributes)) {
    return check('lfs-rule', 'warn', m.lfsRuleMissing, m.lfsRuleMissingHint);
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
    ? check('lfs-rule', 'ok', m.lfsRuleOk)
    : check('lfs-rule', 'warn', m.lfsFilterMissing, m.lfsFilterMissingHint);
}

async function checkBindings(cfg: UserConfig | undefined, homes: Homes): Promise<DoctorCheck[]> {
  if (cfg === undefined) return [check('bindings', 'warn', m.bindingsSkipped)];
  const out: DoctorCheck[] = [];
  for (const { backlog, handle, path } of boundPaths(cfg, homes)) {
    if (await exists(path)) continue;
    out.push(
      check(
        'bindings',
        'warn',
        m.bindingMissing(backlog, handle, path),
        m.bindingMissingHint(backlog),
      ),
    );
  }
  return out.length === 0 ? [check('bindings', 'ok', m.bindingsOk)] : out;
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
          m.alternateMissing(clone, target),
          `git -C ${clone} repack -a -d && rm ${file}`,
        ),
      );
    }
  }
  return out.length === 0 ? [check('alternates', 'ok', m.alternatesOk)] : out;
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
  if (leftovers.length === 0) return check('temp', 'ok', m.noTempLeftovers);
  if (!fix) {
    return check('temp', 'warn', m.tempLeftovers(leftovers.length), 'backe doctor --fix');
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
    ? check('temp', 'ok', m.removedCount(removed))
    : check('temp', 'warn', m.removedPartly(removed, leftovers.length), m.checkPermissionsHint);
}

function checkReferences(snapshot: BacklogSnapshot): DoctorCheck[] {
  const out: DoctorCheck[] = [];
  const byKey = <T>(map: Map<string, T>) => [...map].sort(([a], [b]) => compareCodeUnits(a, b));
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
          m.leadMissingHint(projectFile(path)),
        ),
      );
    }
  }
  return out.length === 0 ? [check('references', 'ok', m.referencesOk)] : out;
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
    checks.push(check('user-config', 'ok', m.userConfigValid));
  } catch (error) {
    checks.push(check('user-config', 'fail', message(error), 'backe config edit'));
  }

  if (ctx === undefined) {
    checks.push(
      check('backlog', 'warn', input.contextError ?? m.noBacklogResolved, 'backe backlog list'),
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
      ...(problems.length === 0 ? [check('problems', 'ok', m.noProblemFiles)] : problems),
    );
    checks.push(...checkReferences(snapshot));
  }
  return checks;
}

/** Ein `fail` macht den Lauf zu einem `validation`-Fehler (Exit 2), nachdem der Bericht ausgegeben ist. */
export function doctorFailure(checks: readonly DoctorCheck[]): BackeError | undefined {
  const failed = checks.filter((c) => c.status === 'fail').length;
  return failed === 0 ? undefined : new BackeError('validation', m.checksFailed(failed));
}
