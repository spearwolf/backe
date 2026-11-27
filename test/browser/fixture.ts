/**
 * Fixture der Browser-E2E: ein isoliertes Zuhause mit zwei Backlogs, ein `backe ui` aus dem
 * gebauten `dist/cli.js` und eine Seite, die nach dem Test ohne Konsolenfehler und ohne Antwort
 * ≥ 400 der App dastehen muss. Bewusst ohne die Vitest-Helfer aus `test/e2e/`: Die setzen
 * Vitest-Konfiguration beim Import.
 */
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';

export { expect } from '@playwright/test';

const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const START = /^backe ui: (http:\/\/127\.0\.0\.1:(\d+))\/\?token=[0-9a-f]{64}$/;
/** So lange darf `backe ui` nach SIGTERM brauchen, bevor SIGKILL folgt. */
const STOP_GRACE_MS = 5_000;
/** So lange darf die Startzeile ausbleiben, wie im Pack-Smoke-Test (`read -t 20`). */
const START_DEADLINE_MS = 20_000;

export type UiHome = {
  /** Temp-Wurzel; `home/` und `.backe/` darunter. */
  dir: string;
  env: Record<string, string>;
  /** Arbeitskopien der Backlogs `acme` (Präfix `ac`, Start-Backlog) und `beta` (Präfix `bt`). */
  acme: string;
  beta: string;
  /** `node dist/cli.js …` in `cwd` (Default `acme`), wirft bei Exit ≠ 0. */
  cli(args: string[], cwd?: string): Promise<string>;
};

export type UiServer = { url: string; origin: string; stop(): Promise<void> };

function run(
  file: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string> },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, opts, (error, stdout, stderr) => {
      if (error) reject(new Error(`${file} ${args.join(' ')} failed: ${error.message}\n${stderr}`));
      else resolve(stdout);
    });
  });
}

/** Beendet `child` mit SIGTERM, nach `STOP_GRACE_MS` mit SIGKILL; ein beendeter Prozess bleibt so. */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  child.kill('SIGTERM');
  let timer: NodeJS.Timeout | undefined;
  const grace = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), STOP_GRACE_MS);
  });
  const outcome = await Promise.race([closed, grace]);
  clearTimeout(timer);
  if (outcome === 'late') {
    child.kill('SIGKILL');
    await closed;
  }
}

/**
 * Die erste Zeile auf stdout. Endet der Prozess vorher oder kommt sie nicht binnen
 * `START_DEADLINE_MS`, scheitert sie mit seinem stderr. Die Listener bleiben danach hängen, damit
 * beide Pipes weiter abfließen und der Server nie an einer vollen Pipe stehen bleibt.
 */
function startLine(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      child.off('close', early);
      finish();
    };
    const deadline = setTimeout(() => {
      settle(() => reject(new Error(`backe ui printed no start line in time: ${stderr}`)));
    }, START_DEADLINE_MS);
    const early = (code: number | null) => {
      settle(() =>
        reject(new Error(`backe ui exited with ${code} before the start line: ${stderr}`)),
      );
    };
    child.once('close', early);
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      if (!settled) stderr += chunk;
    });
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      if (settled) return;
      stdout += chunk;
      const nl = stdout.indexOf('\n');
      if (nl >= 0) settle(() => resolve(stdout.slice(0, nl)));
    });
  });
}

async function makeHome(dir: string): Promise<UiHome> {
  const home = join(dir, 'home');
  await mkdir(home);
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    BACKE_HOME: join(home, '.backe'),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    // git liest `$XDG_CONFIG_HOME/git/…` neben GIT_CONFIG_GLOBAL; ein Pfad unter /dev/null existiert nie.
    XDG_CONFIG_HOME: '/dev/null/xdg',
    BACKE_USER: 'spw',
    // Die Specs wählen über englische Beschriftungen aus.
    BACKE_LANG: 'en',
    NO_COLOR: '1',
  };
  const acme = join(dir, 'acme');
  const beta = join(dir, 'beta');
  const cli = (args: string[], cwd = acme) => run(process.execPath, [CLI, ...args], { cwd, env });

  await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, 'key')], {
    cwd: dir,
    env,
  });
  for (const [name, prefix, wc] of [
    ['acme', 'ac', acme],
    ['beta', 'bt', beta],
  ] as const) {
    const remote = join(dir, `${name}.git`);
    await run('git', ['init', '--bare', '-q', '-b', 'main', remote], { cwd: dir, env });
    const key = join(dir, 'key.pub');
    const init = ['init', wc, '--name', name, '--prefix', prefix, '--remote', remote];
    await cli([...init, '--key', key, '--user-name', 'Spw'], dir);
    await cli(['config', 'set', `backlogs.${name}.sync.mode`, 'manual'], wc);
  }
  return { dir, env, acme, beta, cli };
}

// Ohne eigene Typangabe: Specs brauchen neben `home`, `ui` und `app` auch die eingebauten Fixtures
// und Optionen (`page`, `colorScheme`), um sie zu überschreiben oder per `test.use` zu setzen.
export const test = base.extend<{
  home: UiHome;
  ui: UiServer;
  app: Page;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright verlangt das Objektmuster auch ohne Fixtures.
  home: async ({}, use) => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'backe-browser-')));
    try {
      await use(await makeHome(dir));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },

  ui: async ({ home }, use) => {
    const child = spawn(process.execPath, [CLI, 'ui', '--port', '0'], {
      cwd: home.acme,
      env: home.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      const line = await startLine(child);
      const match = START.exec(line);
      if (match === null) throw new Error(`start line does not match ${START}: ${line}`);
      const url = line.slice('backe ui: '.length);
      await use({ url, origin: match[1] as string, stop: () => stopChild(child) });
    } finally {
      await stopChild(child);
    }
  },

  app: async ({ page, ui }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('response', (res) => {
      if (res.url().startsWith(ui.origin) && res.status() >= 400) {
        errors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
      }
    });
    // Die Start-URL tauscht das Token gegen den Cookie und leitet mit 303 auf denselben Pfad ohne
    // Token weiter. Mit dem Pfad des Backlogs ist das eine einzige Navigation: Eine zweite brächte
    // die Abrufe der ersten Seite ab, und WebKit meldet abgebrochene Abrufe als Seitenfehler.
    const start = new URL(ui.url);
    start.pathname = '/b/acme/backlog';
    await page.goto(start.href);
    await expect(page).toHaveURL(`${ui.origin}/b/acme/backlog`);
    await expect(page.getByRole('button', { name: 'acme', exact: true })).toBeVisible();
    await use(page);
    expect(errors).toEqual([]);
  },
});
