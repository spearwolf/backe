/**
 * Misst `backe ui` gegen die Ziele aus ui.md §2.17 an einem Backlog mit 10⁴ Issues
 * (`scripts/bench-backlog.ts`) samt Nachbar-Arbeitskopien: `GET /state`, erste Darstellung des
 * Tabs Backlog, Write im CLI bis zur Anzeige, Board-Drag und Scrollen. Gemessen wird gegen das
 * gebaute `dist/cli.js` (vorher `pnpm run build`) mit Chromium aus `@playwright/test`.
 *
 * Aufruf: `node scripts/bench-ui.ts [--issues 10000] [--neighbors 20] [--runs 5]`. Kein Teil von
 * `mise run check`. Gedrosselt wird nur die Messseite per CDP (`Emulation.setCPUThrottlingRate`),
 * nie die Maschine. Alles liegt in einem Temp-Verzeichnis mit eigenem `HOME` und `BACKE_HOME`, das
 * der Lauf in `finally` abräumt, auch nach einem Fehler oder Ctrl-C.
 *
 * Der Code, der in der Seite läuft, steht als Quelltext in Strings: Das Wurzelprojekt prüft
 * `scripts/` ohne DOM-Typen.
 */
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { availableParallelism, cpus, release, tmpdir, totalmem, type } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type Browser, type BrowserContext, chromium, type Page } from '@playwright/test';
import { BENCH_SPRINTS, benchIssue, writeBenchFiles } from './bench-backlog.ts';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const START = /^backe ui: (http:\/\/127\.0\.0\.1:(\d+))\/\?token=([0-9a-f]{64})$/;
const BACKLOG = 'bench';
/** Höchstens so viele Issues je `backe commit` (Batch-Grenze 1000 Operationen, dazu Sprints und Projekte). */
const COMMIT_BLOCK = 800;
const STOP_GRACE_MS = 5_000;
const START_DEADLINE_MS = 60_000;
/** Frist für Zustände im Browser; mit 4× Drosselung lädt ein Backlog mit 10⁴ Issues deutlich länger. */
const WAIT_MS = 120_000;
const THROTTLE = 4;
/** Frame-Drop: zwei rAF-Zeitstempel weiter auseinander als 1,5 Frames bei 60 Hz. */
const DROP_MS = 25;
const DRAG_START_MS = 300;
/** Bewegungen von der Startkarte bis zur Zielzelle, eine je Frame. */
const DRAG_STEPS = 40;
const CLI_WRITES = 10;
/** Pause zwischen zwei Writes; mit der Laufzeit des CLI verteilen sich zehn Writes über mehrere 10-s-Takte. */
const WRITE_PAUSE_MS = 1_500;
const SCROLL_MS = 4_000;
const SCROLL_STEP_PX = 48;
/** So lange misst der Leerlauf des Servers: zwei Takte des Sicherheitsnetzes (10 s). */
const IDLE_MS = 20_000;
/** Ruhig ist der Server, wenn er in einer Sekunde weniger CPU-Zeit braucht. */
const CALM_MS = 50;
/** Ruhig ist die Seite, wenn so lange kein rAF-Abstand über `DROP_MS` lag. */
const QUIET_MS = 500;
/** Texte des Ladehinweises (`m.loading` in `web/src/app/app.messages.ts`), englisch und deutsch. */
const LOADING = ['Loading …', 'Lädt …'];

const { values: opts } = parseArgs({
  options: {
    issues: { type: 'string', default: '10000' },
    neighbors: { type: 'string', default: '20' },
    runs: { type: 'string', default: '5' },
    // Zeichnet die Board-Szenarien per Chromium-Tracing auf (`board-<Gruppierung>.json` darin),
    // zum Öffnen in den DevTools (Performance) oder in Perfetto.
    trace: { type: 'string' },
    // Nur diese Messungen, durch Komma getrennt: state, backlog, write, board, scroll.
    only: { type: 'string', default: 'state,backlog,write,board,scroll' },
  },
});
const N = Number(opts.issues);
const NEIGHBORS = Number(opts.neighbors);
const RUNS = Number(opts.runs);
const TRACE = opts.trace;
const MEASURES = ['state', 'backlog', 'write', 'board', 'scroll'] as const;
const ONLY = new Set(opts.only.split(','));
if (
  ![N, NEIGHBORS, RUNS].every(Number.isInteger) ||
  N < 100 ||
  NEIGHBORS < 0 ||
  RUNS < 1 ||
  [...ONLY].some((m) => !(MEASURES as readonly string[]).includes(m))
) {
  console.error(
    'Aufruf: node scripts/bench-ui.ts [--issues <n ≥ 100>] [--neighbors <n ≥ 0>] [--runs <n ≥ 1>] [--trace <dir>] [--only state,backlog,write,board,scroll]',
  );
  process.exit(2);
}
if (!existsSync(CLI)) {
  console.error(`${CLI} fehlt; erst »pnpm run build«.`);
  process.exit(2);
}

// --- Prozesse (wie `test/browser/fixture.ts`) ---------------------------------------------------

type Env = Record<string, string>;

function run(file: string, args: string[], cwd: string, env: Env): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd, env, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error)
        reject(new Error(`${file} ${args.join(' ')} scheiterte: ${error.message}\n${stderr}`));
      else resolve(stdout);
    });
  });
}

/** Beendet `child` mit SIGTERM, nach `STOP_GRACE_MS` mit SIGKILL. */
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

/** Erste Zeile auf stdout; die Listener bleiben danach hängen, damit beide Pipes abfließen. */
function startLine(child: ChildProcess, stderr: { text: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      child.off('close', early);
      finish();
    };
    const deadline = setTimeout(() => {
      settle(() => reject(new Error(`backe ui gab keine Startzeile aus: ${stderr.text}`)));
    }, START_DEADLINE_MS);
    const early = (code: number | null) => {
      settle(() =>
        reject(new Error(`backe ui endete mit ${code} vor der Startzeile: ${stderr.text}`)),
      );
    };
    child.once('close', early);
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr.text += chunk;
    });
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      if (settled) return;
      stdout += chunk;
      const nl = stdout.indexOf('\n');
      if (nl >= 0) settle(() => resolve(stdout.slice(0, nl)));
    });
  });
}

// --- Statistik ----------------------------------------------------------------------------------

const sorted = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);
const median = (xs: readonly number[]) => sorted(xs)[Math.floor((xs.length - 1) / 2)] ?? Number.NaN;
const max = (xs: readonly number[]) => (xs.length === 0 ? Number.NaN : Math.max(...xs));
function p95(xs: readonly number[]): number {
  const s = sorted(xs);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] ?? Number.NaN;
}
const ms = (x: number) => (Number.isNaN(x) ? '–' : `${x.toFixed(x < 100 ? 1 : 0)} ms`);
const gapsOf = (times: readonly number[]) => times.slice(1).map((t, i) => t - (times[i] as number));

// --- Aufbau -------------------------------------------------------------------------------------

type Bench = { dir: string; env: Env; wc: string; cli(args: string[]): Promise<string> };

async function setUp(dir: string): Promise<Bench> {
  const home = join(dir, 'home');
  await mkdir(home);
  const env: Env = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    BACKE_HOME: join(home, '.backe'),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    // git liest `$XDG_CONFIG_HOME/git/…` neben GIT_CONFIG_GLOBAL; ein Pfad unter /dev/null existiert nie.
    XDG_CONFIG_HOME: '/dev/null/xdg',
    BACKE_USER: 'spw',
    // Der Ladehinweis wird über seinen Text erkannt; beide Sprachen stehen in `LOADING`.
    BACKE_LANG: 'en',
    NO_COLOR: '1',
  };
  const wc = join(dir, BACKLOG);
  const remote = join(dir, `${BACKLOG}.git`);
  const cli = (args: string[], cwd = wc) => run(process.execPath, [CLI, ...args], cwd, env);

  await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, 'key')], dir, env);
  await run('git', ['init', '--bare', '-q', '-b', 'main', remote], dir, env);
  const init = ['init', wc, '--name', BACKLOG, '--prefix', 'bk', '--remote', remote];
  await cli([...init, '--key', join(dir, 'key.pub'), '--user-name', 'Spw'], dir);
  await cli(['config', 'set', `backlogs.${BACKLOG}.sync.mode`, 'manual']);

  const t0 = performance.now();
  for (let from = 0; from < N; from += COMMIT_BLOCK) {
    const to = Math.min(N, from + COMMIT_BLOCK);
    await writeBenchFiles(wc, N, from, to);
    await cli(['commit']);
    process.stdout.write(`\rBacklog: ${to}/${N} Issues committet`);
  }
  await cli(['sync']);
  console.log(`, gesynct (${((performance.now() - t0) / 1000).toFixed(0)} s)`);

  // Nachbarn nach ui.md §2.4.1 Punkt 3: Klone ohne Checkout tragen `refs/remotes/origin/main`.
  const neighbors = join(env.BACKE_HOME as string, 'backlogs', BACKLOG);
  await mkdir(neighbors, { recursive: true });
  for (let k = 1; k <= NEIGHBORS; k++) {
    await run(
      'git',
      ['clone', '-q', '--no-checkout', remote, join(neighbors, `agent-${k}`)],
      dir,
      env,
    );
  }
  console.log(`Nachbarn: ${NEIGHBORS} unter ${neighbors}`);
  return { dir, env, wc, cli };
}

type Server = { child: ChildProcess; origin: string; port: number; token: string };

async function startServer(b: Bench): Promise<Server> {
  const child = spawn(process.execPath, [CLI, 'ui', '--port', '0'], {
    cwd: b.wc,
    env: b.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderr = { text: '' };
  try {
    const line = await startLine(child, stderr);
    const match = START.exec(line);
    if (match === null) throw new Error(`Startzeile passt nicht zu ${START}: ${line}`);
    return {
      child,
      origin: match[1] as string,
      port: Number(match[2]),
      token: match[3] as string,
    };
  } catch (err) {
    await stopChild(child);
    throw err;
  }
}

// --- GET /state ---------------------------------------------------------------------------------

/** Ein Abruf von `/state` per `node:http`: Zeit bis zum letzten Byte, Größe, Zahl der Issues. */
function getState(s: Server): Promise<{ ms: number; bytes: number; issues: number }> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const req = request(`${s.origin}/api/b/${BACKLOG}/state`, {
      headers: { cookie: `backe_ui_${s.port}=${s.token}` },
    });
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const elapsed = performance.now() - start;
        const body = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          reject(new Error(`/state: ${res.statusCode} ${body.toString('utf8').slice(0, 300)}`));
          return;
        }
        const state = JSON.parse(body.toString('utf8')) as { issues: unknown[] };
        resolve({ ms: elapsed, bytes: body.length, issues: state.issues.length });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// --- Browser ------------------------------------------------------------------------------------

/** Merkt sich `performance.now()` im ersten rAF, in dem die Liste Zeilen zeigt und kein Ladehinweis steht. */
const FIRST_ROWS = `(() => {
  const loading = new Set(${JSON.stringify(LOADING)});
  const tick = () => {
    const rows = document.querySelector('li[data-id]') !== null;
    const hint = rows && [...document.querySelectorAll('p')].some((p) => loading.has(p.textContent.trim()));
    if (rows && !hint) window.__benchFirstRows = performance.now();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

/**
 * rAF-Logger für das Board: jeder Frame als `performance.now()`; dazu `pointerdown`/`pointerup`
 * (Zeitstempel des Ereignisses). Nach `pointerup` prüft der erste rAF, ob die Karte aus
 * `__probe` schon in der Zielzelle steht; registriert wird er in der Bubble-Phase am Fenster,
 * also nach den Listenern am Dokument (dnd-kit) und deren rAFs. Die Schleife merkt sich außerdem
 * den ersten Frame, in dem die Karte in der Zielzelle steht.
 */
const RAF_LOGGER = `(() => {
  window.__raf = [];
  window.__probe = null;
  const inCell = () => {
    const p = window.__probe;
    if (p === null) return false;
    const cell = document.querySelector('ul[data-lane="' + CSS.escape(p.lane) + '"][data-column="' + p.column + '"]');
    return cell !== null && cell.querySelector(':scope > li[data-card="' + CSS.escape(p.id) + '"]') !== null;
  };
  const loop = () => {
    const now = performance.now();
    window.__raf.push(now);
    const p = window.__probe;
    if (p !== null && p.up !== undefined && p.landed === undefined && inCell()) p.landed = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.addEventListener('pointerdown', (e) => {
    if (window.__probe === null) return;
    window.__probe.down = e.timeStamp;
    window.__probe.pressed = e.target.closest('li[data-card]')?.dataset.card ?? null;
  }, true);
  // Vor dnd-kit (Capture am Fenster): welche Zelle beim Loslassen markiert ist.
  window.addEventListener('pointerup', () => {
    const p = window.__probe;
    if (p === null) return;
    const over = document.querySelector('ul[data-over]');
    p.overAtUp = over === null ? null : over.dataset.lane + ':' + over.dataset.column;
  }, true);
  window.addEventListener('pointerup', (e) => {
    const p = window.__probe;
    if (p === null || p.down === undefined) return;
    p.up = e.timeStamp;
    requestAnimationFrame(() => {
      p.frame = performance.now();
      p.inFrame = inCell();
    });
  });
})();`;

/** Zustand beim Ziehen für Fehlermeldungen: Probe, markierte Zelle, gezogene Karte, Scrollstand, Ziel. */
const DRAG_STATE = (target: string) => `JSON.stringify({
  probe: window.__probe,
  over: [...document.querySelectorAll('ul[data-over]')].map((u) => u.dataset.lane + ':' + u.dataset.column),
  dragging: [...document.querySelectorAll('li[data-dragging]')].map((li) => li.dataset.card),
  scroller: (() => {
    const el = document.querySelector('ul[data-column]')?.closest('.overflow-auto');
    return el ? { top: el.scrollTop, left: el.scrollLeft, height: el.clientHeight } : null;
  })(),
  target: document.querySelector(${JSON.stringify(target)})?.getBoundingClientRect().toJSON() ?? null,
  source: document.querySelector(${JSON.stringify(target.replace('in_progress', 'todo'))})?.getBoundingClientRect().toJSON() ?? null,
  page: document.scrollingElement?.scrollTop ?? null,
  lanes: [...document.querySelectorAll('ul[data-column="todo"]')].map((u) => u.dataset.lane + '@' + Math.round(u.getBoundingClientRect().top)),
})`;

/** Wartet im Seitenkontext, bis `QUIET_MS` lang kein rAF-Abstand über `DROP_MS` lag. */
const QUIET = `new Promise((resolve) => {
  let last = performance.now();
  let calm = last;
  const tick = () => {
    const now = performance.now();
    if (now - last > ${DROP_MS}) calm = now;
    last = now;
    if (now - calm >= ${QUIET_MS}) resolve(true);
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})`;

/**
 * Merkt sich die Wanduhr (`Date.now()`), sobald der Text aus `__benchWant` im DOM steht: als
 * neuer Textknoten, geänderter Text oder in einem eingefügten Teilbaum.
 */
const TITLE_WATCH = `(() => {
  window.__benchWant = null;
  window.__benchSeen = {};
  const hit = (text) => typeof text === 'string' && text.includes(window.__benchWant);
  new MutationObserver((records) => {
    const want = window.__benchWant;
    if (want === null || window.__benchSeen[want] !== undefined) return;
    const now = Date.now();
    for (const r of records) {
      const found =
        (r.type === 'characterData' && hit(r.target.data)) ||
        [...r.addedNodes].some((n) => n.isConnected && hit(n.textContent));
      if (found) {
        window.__benchSeen[want] = now;
        return;
      }
    }
  }).observe(document, { subtree: true, childList: true, characterData: true });
})();`;

const boardView = (group: string) =>
  `localStorage.setItem(${JSON.stringify(`backe-ui:${BACKLOG}:board-view`)}, ${JSON.stringify(
    JSON.stringify({ group, showBacklog: false }),
  )});`;

async function newContext(browser: Browser, s: Server): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: `backe_ui_${s.port}`, value: s.token, url: s.origin }]);
  return ctx;
}

/** Neue Seite, die Konsolenfehler, Seitenfehler und Antworten ≥ 400 der App in `errors` sammelt. */
async function newPage(ctx: BrowserContext, s: Server, errors: string[]): Promise<Page> {
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('response', (res) => {
    if (res.url().startsWith(s.origin) && res.status() >= 400) {
      errors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });
  return page;
}

async function throttle(page: Page, rate: number): Promise<void> {
  if (rate === 1) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

const quiet = (page: Page) => page.evaluate(QUIET);
const nextFrame = (page: Page) =>
  page.evaluate('new Promise((resolve) => requestAnimationFrame(() => resolve(true)))');

let clockTicks: number | undefined;

type Cpu = { node: number; git: number };

/**
 * CPU-Zeit (ms) des Prozesses `pid` samt seiner beendeten Kinder aus `/proc/<pid>/stat` (utime,
 * stime, cutime, cstime); `undefined` ohne `/proc`. Die Kinder sind die `git`-Aufrufe des Servers.
 */
async function cpuOf(pid: number | undefined): Promise<Cpu | undefined> {
  if (pid === undefined) return undefined;
  try {
    clockTicks ??= Number(
      (await run('getconf', ['CLK_TCK'], '/', { PATH: process.env.PATH ?? '' })).trim(),
    );
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    // Nach dem Prozessnamen in Klammern; Feld 14–17 der Manpage sind hier Index 11–14.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const msOf = (a: number, b: number) =>
      ((Number(fields[a]) + Number(fields[b])) / (clockTicks as number)) * 1000;
    return { node: msOf(11, 12), git: msOf(13, 14) };
  } catch {
    return undefined;
  }
}

/**
 * Wartet, bis der Server eine Sekunde lang weniger als `CALM_MS` CPU-Zeit (Node und git) gebraucht
 * hat, höchstens eine Minute. Die Sekunde ist das Messintervall, keine Wartezeit auf einen Zustand.
 */
async function serverCalm(pid: number | undefined): Promise<void> {
  for (let k = 0; k < 60; k++) {
    const a = await cpuOf(pid);
    await sleep(1_000);
    const b = await cpuOf(pid);
    if (a === undefined || b === undefined) return;
    if (b.node + b.git - a.node - a.git < CALM_MS) return;
  }
}

/**
 * Wartet, bis der Ausdruck `expr` in der Seite wahr ist. Nicht per `page.waitForFunction`: Das
 * wertet einen Ausdruck per `eval` in der Seite aus, und die CSP der UI verbietet `unsafe-eval`;
 * `page.evaluate` läuft über CDP und ist davon nicht betroffen. Geprüft wird per `setTimeout`, nicht
 * per rAF: Eine Seite im Hintergrund bekäme keinen Frame.
 */
function until(page: Page, expr: string): Promise<unknown> {
  return page.evaluate(`new Promise((resolve, reject) => {
    const end = performance.now() + ${WAIT_MS};
    const tick = () => {
      if (${expr}) resolve(true);
      else if (performance.now() > end) reject(new Error(${JSON.stringify(`Frist abgelaufen: ${expr}`)}));
      else setTimeout(tick, 10);
    };
    tick();
  })`);
}

// --- Messungen ----------------------------------------------------------------------------------

type Row = { goal: string; what: string; value: string; ok: boolean | undefined };

/** Erste vollständige Darstellung des Tabs Backlog: je Lauf ein frischer Kontext. */
async function backlogRender(browser: Browser, s: Server, rate: number, errors: string[]) {
  const times: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const ctx = await newContext(browser, s);
    try {
      const page = await newPage(ctx, s, errors);
      await throttle(page, rate);
      await page.addInitScript(FIRST_ROWS);
      await page.goto(`${s.origin}/b/${BACKLOG}/backlog`);
      await until(page, 'window.__benchFirstRows !== undefined');
      times.push((await page.evaluate('window.__benchFirstRows')) as number);
    } finally {
      await ctx.close();
    }
  }
  return times;
}

/** Scrollt die Liste je Frame um `SCROLL_STEP_PX` weiter, `SCROLL_MS` lang; zurück die rAF-Zeiten. */
async function scrollList(browser: Browser, s: Server, rate: number, errors: string[]) {
  const ctx = await newContext(browser, s);
  try {
    const page = await newPage(ctx, s, errors);
    await throttle(page, rate);
    await page.addInitScript(FIRST_ROWS);
    await page.goto(`${s.origin}/b/${BACKLOG}/backlog`);
    await until(page, 'window.__benchFirstRows !== undefined');
    await quiet(page);
    const times = (await page.evaluate(`new Promise((resolve) => {
      const list = document.querySelector('li[data-id]').closest('ul').parentElement;
      const times = [];
      const start = performance.now();
      const step = () => {
        const now = performance.now();
        times.push(now);
        list.scrollTop += ${SCROLL_STEP_PX};
        if (now - start < ${SCROLL_MS}) requestAnimationFrame(step);
        else resolve({ times, top: list.scrollTop });
      };
      requestAnimationFrame(step);
    })`)) as { times: number[]; top: number };
    if (times.top < SCROLL_STEP_PX * 10)
      throw new Error(`Liste scrollt nicht (scrollTop ${times.top})`);
    return gapsOf(times.times);
  } finally {
    await ctx.close();
  }
}

type DragResult = {
  startGap: number;
  dragGap: number;
  upToFrame: number;
  inFrame: boolean;
  upToLanded: number;
  /** Frames über `DROP_MS`: Abstand und Beginn, gerechnet ab `pointerdown` bzw. `pointerup` (`↑`). */
  long: string[];
};

/**
 * Ob die Mitte von `box` in der mittleren Hälfte der Höhe `viewport` liegt: weit genug weg von den
 * 20 % am Rand des Scrollbereichs, in denen dnd-kit beim Ziehen scrollt. Ganz mittig geht nicht
 * immer, die erste Karte einer Bahn ganz oben lässt sich nicht weiter herunterscrollen.
 */
const centred = (box: { y: number; height: number } | null, viewport: number): boolean =>
  box !== null &&
  box.y + box.height / 2 > viewport / 4 &&
  box.y + box.height / 2 < (viewport * 3) / 4;

/** Fünf (`RUNS`) Züge von `todo` nach `in_progress` derselben Bahn `lane`. */
async function boardDrag(
  browser: Browser,
  s: Server,
  group: string,
  lane: string,
  errors: string[],
): Promise<{ cards: number; drags: DragResult[] }> {
  const ctx = await newContext(browser, s);
  try {
    const page = await newPage(ctx, s, errors);
    await page.addInitScript(boardView(group));
    await page.addInitScript(RAF_LOGGER);
    await page.goto(`${s.origin}/b/${BACKLOG}/board`);
    const sel = (column: string) => `ul[data-lane="${lane}"][data-column="${column}"]`;
    const source = page.locator(`${sel('todo')} > li[data-card]`).first();
    await source.waitFor({ timeout: WAIT_MS });
    await quiet(page);
    // Karten in aufgeklappten Bahnen, aus den Zählern der Spalten: Große Zellen rendern nur die
    // sichtbaren Karten, das DOM zählt also zu wenig.
    const cards = (await page.evaluate(
      `[...document.querySelectorAll('[data-head] [aria-hidden="true"]')].reduce((n, e) => n + Number(e.textContent), 0)`,
    )) as number;
    const profiler = TRACE === undefined ? undefined : await page.context().newCDPSession(page);
    if (TRACE !== undefined && profiler !== undefined) {
      await mkdir(TRACE, { recursive: true });
      await profiler.send('Profiler.enable');
      await profiler.send('Profiler.setSamplingInterval', { interval: 100 });
      await profiler.send('Profiler.start');
      await browser.startTracing(page, {
        path: join(TRACE, `board-${group}.json`),
        categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'v8'],
      });
    }
    const results: DragResult[] = [];
    for (let r = 0; r < RUNS; r++) {
      const id = await source.getAttribute('data-card');
      if (id === null) throw new Error('Karte ohne data-card');
      // Die Karte mittig ins Bild: Nahe am Rand des Scrollbereichs scrollt dnd-kit beim Ziehen von
      // selbst. Ein Sprung per Skript holt Karten auf einmal ins Bild; bis sie ihre echte Höhe haben
      // (`content-visibility`), steht die Box noch nicht — darum nach jeder Ruhe nachmessen.
      const viewport = page.viewportSize()?.height ?? 800;
      let from = await source.boundingBox();
      for (let k = 0; k < 5 && !centred(from, viewport); k++) {
        await source.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await quiet(page);
        from = await source.boundingBox();
      }
      if (!centred(from, viewport))
        throw new Error(`Karte ${id} steht nicht mittig: ${JSON.stringify(from)}`);
      const target = await page.locator(sel('in_progress')).boundingBox();
      if (from === null || target === null) throw new Error('Karte oder Zielzelle ohne Box');
      await page.evaluate(
        `window.__probe = ${JSON.stringify({ lane, column: 'in_progress', id })}; window.__raf.length = 0;`,
      );
      // Ohne Write lehnt das Warten ab; gefangen, damit der Fehler unten mit der Probe kommt.
      const written = page
        .waitForResponse(
          (res) => res.request().method() === 'POST' && res.url().includes('/tools/'),
          { timeout: WAIT_MS },
        )
        .catch((err: unknown) => err as Error);
      const x = from.x + from.width / 2;
      const y = from.y + from.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      // Verschiebt sich das Layout zwischen Messen und Druck, träfe der Druck eine andere Karte.
      const pressed = await page.evaluate('window.__probe.pressed');
      if (pressed !== id)
        throw new Error(`gedrückt ${String(pressed)} statt ${id}: Layout verschoben`);
      // Eine Bewegung je Frame wie eine echte Maus. Der PointerSensor von dnd-kit startet erst nach
      // 5 px, darum zuerst drei kleine Schritte; dann in die Polsterung der Zielzelle, nicht auf eine
      // Karte: Dort ist die Zelle selbst das Ziel.
      const path: [number, number][] = [1, 2, 3].map((k) => [x + k * 2, y + k * 2]);
      const [x0, y0] = path[2] as [number, number];
      for (let k = 1; k <= DRAG_STEPS; k++) {
        const f = k / DRAG_STEPS;
        path.push([x0 + (target.x + 4 - x0) * f, y0 + (target.y + 4 - y0) * f]);
      }
      for (const [px, py] of path) {
        await page.mouse.move(px, py);
        await nextFrame(page);
      }
      // Mit Probe, Zustand und Fehlern der Seite: Ohne sie sagt eine abgelaufene Frist nicht, was fehlte.
      const failed = async (err: unknown) => {
        const state = await page.evaluate(DRAG_STATE(sel('in_progress')));
        const before = JSON.stringify({ from, target });
        return new Error(
          `${(err as Error).message}; vorher ${before}; Zustand ${state}; Seite: ${errors.join(' | ')}`,
        );
      };
      try {
        await until(
          page,
          `document.querySelector(${JSON.stringify(`${sel('in_progress')}[data-over]`)}) !== null`,
        );
      } catch (err) {
        throw await failed(err);
      }
      await page.mouse.up();
      try {
        await until(
          page,
          'window.__probe.frame !== undefined && window.__probe.landed !== undefined',
        );
      } catch (err) {
        throw await failed(err);
      }
      const res = await written;
      if (res instanceof Error) throw res;
      if (!res.ok()) throw new Error(`Write nach dem Ablegen: ${res.status()}`);
      const probe = (await page.evaluate('({ ...window.__probe, raf: window.__raf.slice() })')) as {
        down: number;
        up: number;
        frame: number;
        inFrame: boolean;
        landed: number;
        raf: number[];
      };
      // Ein Abstand gehört zu dem Abschnitt, in dem er beginnt: Ein langer Frame, den der Start
      // auslöst, endet oft erst nach dem Startfenster.
      const gapsIn = (from: number, to: number) => {
        const out: number[] = [];
        for (let i = 1; i < probe.raf.length; i++) {
          const t = probe.raf[i - 1] as number;
          if (t >= from && t < to) out.push((probe.raf[i] as number) - t);
        }
        return out;
      };
      results.push({
        startGap: max(gapsIn(probe.down, probe.down + DRAG_START_MS)),
        dragGap: max(gapsIn(probe.down + DRAG_START_MS, probe.up)),
        upToFrame: probe.frame - probe.up,
        inFrame: probe.inFrame,
        upToLanded: probe.landed - probe.up,
        long: probe.raf.flatMap((t, i) => {
          const gap = t - (probe.raf[i - 1] ?? t);
          if (gap <= DROP_MS) return [];
          const begin = t - gap;
          const at =
            begin >= probe.up
              ? `↑+${Math.round(begin - probe.up)}`
              : `+${Math.round(begin - probe.down)}`;
          return [`${Math.round(gap)}@${at}`];
        }),
      });
      await page.evaluate('window.__probe = null');
      await quiet(page);
    }
    if (TRACE !== undefined && profiler !== undefined) {
      await browser.stopTracing();
      const { profile } = await profiler.send('Profiler.stop');
      await writeFile(join(TRACE, `board-${group}.cpuprofile`), JSON.stringify(profile));
    }
    return { cards, drags: results };
  } finally {
    await ctx.close();
  }
}

type WriteResult = {
  /** CPU-Zeit des Servers und seiner beendeten Kinder (git) je 10 s im Leerlauf; `undefined` ohne `/proc`. */
  idleCpu: Cpu | undefined;
  cliMs: number[];
  /** `t1 − t0` je Ansicht, `t0` = Ende des CLI-Prozesses. */
  lag: Record<string, number[]>;
  /** `t1 − tRef` je Ansicht, `tRef` = Ereignis auf `refs/heads/main` der Arbeitskopie. */
  refLag: Record<string, number[]>;
};

/**
 * Zehn Writes per CLI auf `id`; je Write und offener Ansicht `t1 − t0`. Der Ref steht schon vor dem
 * Ende des Prozesses (danach kommen Ausgabe und Exit); darum zusätzlich ab dem Watch-Ereignis auf
 * den Ref, beobachtet aus diesem Prozess.
 */
async function cliWrites(
  browser: Browser,
  b: Bench,
  s: Server,
  id: string,
  errors: string[],
): Promise<WriteResult> {
  const ctx = await newContext(browser, s);
  try {
    const views: Record<string, { path: string; ready: string; init?: string }> = {
      Backlog: { path: 'backlog', ready: `li[data-id="${id}"]` },
      'Board (none)': { path: 'board', ready: `li[data-card="${id}"]`, init: boardView('none') },
      'Issue-Tab': { path: `issue/${id}`, ready: 'h1' },
    };
    const pages: [string, Page][] = [];
    for (const [name, v] of Object.entries(views)) {
      const page = await newPage(ctx, s, errors);
      if (v.init !== undefined) await page.addInitScript(v.init);
      await page.addInitScript(TITLE_WATCH);
      await page.goto(`${s.origin}/b/${BACKLOG}/${v.path}`);
      await page.locator(v.ready).first().waitFor({ timeout: WAIT_MS });
      pages.push([name, page]);
    }
    for (const [, page] of pages) await quiet(page);
    // Leerlauf mit drei Abonnenten: zwei Takte des Sicherheitsnetzes samt Blick auf die Nachbarn.
    // Erst wenn der Server ruhig ist: Nach dem Laden der Seiten arbeitet er noch Sekunden nach.
    await serverCalm(s.child.pid);
    const before = await cpuOf(s.child.pid);
    await sleep(IDLE_MS);
    const after = await cpuOf(s.child.pid);
    const per10s = (a: number, b: number) => ((b - a) / IDLE_MS) * 10_000;
    const idleCpu =
      before === undefined || after === undefined
        ? undefined
        : { node: per10s(before.node, after.node), git: per10s(before.git, after.git) };
    const perView = () => Object.fromEntries(pages.map(([n]): [string, number[]] => [n, []]));
    const result: WriteResult = { idleCpu, cliMs: [], lag: perView(), refLag: perView() };
    let refAt: number | undefined;
    const refs = watch(join(b.wc, '.git', 'refs', 'heads'), (_event, name) => {
      if (name === 'main') refAt ??= Date.now();
    });
    try {
      for (let k = 1; k <= CLI_WRITES; k++) {
        const title = `Bench ${String(k).padStart(2, '0')}`;
        for (const [, page] of pages)
          await page.evaluate(`window.__benchWant = ${JSON.stringify(title)}`);
        refAt = undefined;
        const start = Date.now();
        await b.cli(['issue', 'edit', id, '--title', title]);
        const t0 = Date.now();
        result.cliMs.push(t0 - start);
        for (const [name, page] of pages) {
          const seen = `window.__benchSeen[${JSON.stringify(title)}]`;
          await until(page, `${seen} !== undefined`);
          const t1 = (await page.evaluate(seen)) as number;
          result.lag[name]?.push(t1 - t0);
          if (refAt !== undefined) result.refLag[name]?.push(t1 - refAt);
        }
        process.stdout.write(`\rCLI-Write ${k}/${CLI_WRITES}`);
        await sleep(WRITE_PAUSE_MS);
      }
    } finally {
      refs.close();
    }
    process.stdout.write('\n');
    return result;
  } finally {
    await ctx.close();
  }
}

// --- Ablauf -------------------------------------------------------------------------------------

async function machine(browser: Browser): Promise<string> {
  let os = `${type()} ${release()}`;
  try {
    const text = await readFile('/etc/os-release', 'utf8');
    const name = /^PRETTY_NAME="?([^"\n]*)"?$/m.exec(text)?.[1];
    if (name !== undefined) os = `${name} (${os})`;
  } catch {
    // Ohne /etc/os-release bleibt es bei Kernel und Version.
  }
  const cpu = cpus()[0]?.model.trim() ?? 'unbekannte CPU';
  const ram = Math.round(totalmem() / 1024 ** 3);
  return `${cpu}, ${availableParallelism()} Threads, ${ram} GB RAM, ${os}, Node ${process.version.slice(1)}, Chromium ${browser.version()}`;
}

const dir = await realpath(await mkdtemp(join(tmpdir(), 'backe-bench-ui-')));
let server: Server | undefined;
let browser: Browser | undefined;
let cleaning: Promise<void> | undefined;
const cleanUp = () => {
  cleaning ??= (async () => {
    await browser?.close().catch(() => {});
    if (server !== undefined) await stopChild(server.child);
    await rm(dir, { recursive: true, force: true });
  })();
  return cleaning;
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.error(`\n${signal}: räume ab …`);
    void cleanUp().finally(() => process.exit(128 + (signal === 'SIGINT' ? 2 : 15)));
  });
}

const wall = performance.now();
try {
  console.log(`bench-ui: ${N} Issues, ${NEIGHBORS} Nachbarn, ${RUNS} Läufe; Temp ${dir}`);
  const bench = await setUp(dir);
  // Ziel der CLI-Writes: das Issue in `todo` mit kleinstem Rang (Rang = Index × 1000).
  let target: string | undefined;
  for (let i = 0; i < N && target === undefined; i++) {
    const issue = benchIssue(i, N);
    if (issue.state === 'todo') target = issue.id as string;
  }
  if (target === undefined) throw new Error('kein Issue in todo');
  const openLane = BENCH_SPRINTS.find((sp) => !sp.closed)?.slug ?? '';

  server = await startServer(bench);
  const rows: Row[] = [];
  const errors: string[] = [];

  if (ONLY.has('state')) {
    // GET /state: der erste Abruf, bevor ein Browser abonniert (kein Watcher), dann warm.
    const cold = await getState(server);
    if (cold.issues !== N) throw new Error(`/state liefert ${cold.issues} statt ${N} Issues`);
    const warm: number[] = [];
    for (let r = 0; r < RUNS; r++) warm.push((await getState(server)).ms);
    const stateGoal = '`GET /state` ≤ 1 s';
    rows.push({
      goal: stateGoal,
      what: `erster Abruf (kalt, ${(cold.bytes / 1e6).toFixed(1)} MB)`,
      value: ms(cold.ms),
      ok: cold.ms <= 1000,
    });
    rows.push({
      goal: stateGoal,
      what: `Median aus ${RUNS} warmen Abrufen`,
      value: ms(median(warm)),
      ok: median(warm) <= 1000,
    });
    console.log(`GET /state: kalt ${ms(cold.ms)}, warm ${warm.map(ms).join(', ')}`);
  }

  browser = await chromium.launch();
  const context = await machine(browser);

  if (ONLY.has('backlog')) {
    const renderGoal = 'Tab Backlog ≤ 1,5 s';
    for (const rate of [1, THROTTLE]) {
      const times = await backlogRender(browser, server, rate, errors);
      const label = rate === 1 ? 'ohne Drosselung' : `CPU ${rate}× (CDP)`;
      rows.push({
        goal: renderGoal,
        what: `erste Zeilen ohne Ladehinweis, ${label}, Median aus ${RUNS}`,
        value: ms(median(times)),
        ok: median(times) <= 1500,
      });
      console.log(`Tab Backlog, ${label}: ${times.map(ms).join(', ')}`);
    }
  }

  if (ONLY.has('write')) {
    const writes = await cliWrites(browser, bench, server, target, errors);
    const writeGoal = 'CLI-Write → sichtbar ≤ 300 ms';
    rows.push({
      goal: writeGoal,
      what: `Server-CPU im Leerlauf (3 Abonnenten, ${NEIGHBORS} Nachbarn) je 10 s: Node / git`,
      value:
        writes.idleCpu === undefined
          ? '–'
          : `${ms(writes.idleCpu.node)} / ${ms(writes.idleCpu.git)}`,
      ok: undefined,
    });
    for (const [name, lag] of Object.entries(writes.lag)) {
      const fromRef = writes.refLag[name] ?? [];
      rows.push({
        goal: writeGoal,
        what: `${name}: Median / Max aus ${CLI_WRITES} ab Prozessende; Max ab Ref (${fromRef.length})`,
        value: `${ms(median(lag))} / ${ms(max(lag))}; ${ms(max(fromRef))}`,
        ok: max(lag) <= 300 && !(max(fromRef) > 300),
      });
      console.log(
        `CLI-Write, ${name}: ab Prozessende ${lag.map(ms).join(', ')}; ab Ref ${fromRef.map(ms).join(', ')}`,
      );
    }
    rows.push({
      goal: writeGoal,
      what: 'Laufzeit des CLI-Prozesses (Schreibpfad BK, nicht UI): Median / Max',
      value: `${ms(median(writes.cliMs))} / ${ms(max(writes.cliMs))}`,
      ok: undefined,
    });
  }

  if (ONLY.has('board')) {
    const dragGoal = 'Board-Drag im selben Frame';
    for (const [group, lane, label] of [
      ['sprint', openLane, `Default (Sprint, Bahn ${openLane})`],
      ['none', '', 'Gruppierung none'],
    ] as const) {
      const { cards, drags } = await boardDrag(browser, server, group, lane, errors);
      const start = max(drags.map((d) => d.startGap));
      const drag = max(drags.map((d) => d.dragGap));
      const up = max(drags.map((d) => d.upToFrame));
      const inFrame = drags.filter((d) => d.inFrame).length;
      const landed = max(drags.map((d) => d.upToLanded));
      const where = `${label}, ${cards} Karten`;
      rows.push({
        goal: dragGoal,
        what: `${where}: Start, größter rAF-Abstand (Max aus ${RUNS})`,
        value: ms(start),
        ok: start <= DROP_MS,
      });
      rows.push({
        goal: dragGoal,
        what: `${where}: Ziehen, größter rAF-Abstand`,
        value: ms(drag),
        ok: drag <= DROP_MS,
      });
      rows.push({
        goal: dragGoal,
        what: `${where}: pointerup → erster rAF; Karte dort in der Zielzelle`,
        value: `${ms(up)}; ${inFrame}/${drags.length}`,
        // Im selben Frame: Die Karte steht im ersten Frame nach dem Loslassen, und der kommt ohne
        // Drop. Strenger als `DROP_MS` geht nicht: Das Loslassen fällt irgendwo in einen Frame, und
        // schon die Abstände zweier Frames schwanken um 16,7 ms.
        ok: up <= DROP_MS && inFrame === drags.length,
      });
      rows.push({
        goal: dragGoal,
        what: `${where}: pointerup → Karte in der Zielzelle (rAF)`,
        value: ms(landed),
        ok: undefined,
      });
      console.log(
        `Board-Drag, ${where}: lange Frames je Zug (Abstand@Beginn ab pointerdown, ↑ ab pointerup): ${drags.map((d) => `[${d.long.join(' ')}]`).join(' ')}`,
      );
    }
  }

  if (ONLY.has('scroll')) {
    const scrollGoal = 'Scrollen ohne Frame-Drops';
    for (const rate of [1, THROTTLE]) {
      const gaps = await scrollList(browser, server, rate, errors);
      const drops = gaps.filter((g) => g > DROP_MS).length;
      const label = rate === 1 ? 'ohne Drosselung' : `CPU ${rate}× (CDP)`;
      rows.push({
        goal: scrollGoal,
        what: `Tab Backlog, ${label}, ${(SCROLL_MS / 1000).toFixed(0)} s: Drops / p95 / Max`,
        value: `${drops} von ${gaps.length} / ${ms(p95(gaps))} / ${ms(max(gaps))}`,
        ok: drops === 0,
      });
    }
  }

  console.log(`\nRechner: ${context}`);
  console.log(`Backlog: ${N} Issues, ${NEIGHBORS} Nachbarn, ${RUNS} Läufe je Messung\n`);
  console.log('| Ziel | Messung | Wert | erreicht |');
  console.log('| --- | --- | --- | --- |');
  for (const r of rows) {
    const ok = r.ok === undefined ? '–' : r.ok ? 'ja' : '**nein**';
    console.log(`| ${r.goal} | ${r.what} | ${r.value} | ${ok} |`);
  }
  if (errors.length > 0) {
    console.log(`\nFehler in den Seiten (${errors.length}):`);
    for (const e of [...new Set(errors)].slice(0, 20)) console.log(`- ${e}`);
  }
  console.log(`\nLaufzeit: ${((performance.now() - wall) / 1000).toFixed(0)} s`);
} finally {
  await cleanUp();
}
