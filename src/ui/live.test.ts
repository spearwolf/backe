import { writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { writeOp } from '../../test/helpers/context.ts';
import {
  rawCommit,
  revParse,
  setPullInterval,
  type TestBacklog,
  testBacklog,
  testKey,
} from '../../test/helpers/git.ts';
import { applyPatch, collect, comparable, fakeTimers, settle } from '../../test/helpers/live.ts';
import { type FakeWatcher, fakeWatcher, PROFILES } from '../../test/helpers/watch.ts';
import { setIdentity } from '../context/registry.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { git } from '../git/exec.ts';
import { bodyHash } from '../ops/operation.ts';
import { addAttachment } from '../services/attachments.ts';
import * as backgroundModule from '../services/background.ts';
import { runBackground } from '../services/background.ts';
import { commitEdits } from '../services/commit.ts';
import * as scheduleModule from '../services/schedule.ts';
import { syncNow } from '../services/sync.ts';
import { writeSyncState } from '../services/sync-state.ts';
import { ensureWorkingCopy } from '../services/working-copy.ts';
import { executeWrite } from '../services/write.ts';
import { atomicTempPath, writeFileAtomic } from '../store/files.ts';
import { BACKLOG_CONFIG, commentsDir, issueFile } from '../store/layout.ts';
import * as snapshotModule from '../store/snapshot.ts';
import * as actorsModule from './actors.ts';
import type { StateJson } from './api.ts';
import { LIVE_TIMING, LiveBacklog, type LiveDeps, LiveHub, parseEventId } from './live.ts';
import { NeighborWatch } from './neighbors.ts';
import * as stateModule from './state.ts';
import { stateJson } from './state.ts';
import { gitDirs, type WatchFn } from './watch.ts';

const BOOT = '0123abcd';

let b: TestBacklog;
let ctx: ResolvedContext;
/** Quelle aller Datei-Ereignisse; Tests unter einem Profil ersetzen ihn in ihrem `beforeEach`. */
let fw: FakeWatcher;
const running: LiveBacklog[] = [];
/** Hintergrund-Syncs, die ein Test in-process gestartet hat; das Aufräumen wartet sie ab. */
const syncs: Promise<unknown>[] = [];

beforeEach(async () => {
  b = await testBacklog();
  ctx = await b.context();
  fw = fakeWatcher();
  fakeTimers();
});
afterEach(async () => {
  for (const l of running.splice(0)) await l.stop();
  await Promise.all(syncs.splice(0));
  vi.useRealTimers();
});

/** Ein Watch, der nie etwas meldet: Es läuft nur das Sicherheitsnetz. */
const deaf: WatchFn = () => ({ close() {} });

async function start(opts: { watch?: WatchFn; rev?: number; onStop?: (rev: number) => void } = {}) {
  const live = await LiveBacklog.start(ctx, {
    boot: BOOT,
    rev: opts.rev ?? 0,
    deps: { watch: opts.watch ?? fw.watch },
    ...(opts.onStop === undefined ? {} : { onStop: opts.onStop }),
  });
  running.push(live);
  return live;
}

/** Meldet, was sich auf der Platte geändert hat, und lässt den Live-Kern zur Ruhe kommen. */
async function tick(live: LiveBacklog): Promise<void> {
  fw.flush();
  await settle(live);
}

/** Lässt das Sicherheitsnetz einmal laufen und wartet seine Runde ab. */
async function safetyNet(live: LiveBacklog): Promise<void> {
  await vi.advanceTimersByTimeAsync(LIVE_TIMING.safetyMs);
  await live.idle();
}

const create = (title: string) => writeOp(ctx, { op: 'issue.create', title, state: 'todo' });

/** Ersetzt im Issue-File von `id` den Titel `from` durch `to`, per Hand und ohne Commit. */
async function retitle(id: string, from: string, to: string): Promise<void> {
  const file = join(b.root, issueFile(id));
  await writeFile(file, (await readFile(file, 'utf8')).replace(`title: ${from}`, `title: ${to}`));
}

test('parseEventId takes boot:rev only', () => {
  expect(parseEventId('0123abcd:5')).toEqual({ boot: '0123abcd', rev: 5 });
  for (const bad of [
    undefined,
    '',
    '0123abcd',
    '0123abcd:-1',
    '0123abcd:05',
    'xyz:1',
    '0123ABCD:1',
  ]) {
    expect(parseEventId(bad)).toBeUndefined();
  }
  expect(parseEventId('0123abcd:99999999999999999999')).toBeUndefined();
});

test('a subscriber gets hello first, then sync', async () => {
  const live = await start();
  const c = collect(live);
  expect(c.names()).toEqual(['hello', 'sync']);
  expect(c.events[0]).toEqual({
    event: 'hello',
    data: { rev: 0, head: (await stateJson(ctx)).head },
    id: `${BOOT}:0`,
  });
});

/**
 * Was ein System meldet, unterscheidet sich (Namen, Zusammenfassung, Reihenfolge); der Live-Kern
 * kommt unter jedem Profil zum selben Ergebnis.
 */
describe.each(PROFILES)('events reported like %s', (profile) => {
  beforeEach(() => {
    fw = fakeWatcher(profile);
  });

  test('a cli write is exactly one patch', async () => {
    const live = await start();
    const c = collect(live);
    const id = await create('Live');
    await tick(live);
    const [patch] = c.patches();
    expect(c.patches()).toHaveLength(1);
    expect(patch?.rev).toBe(1);
    expect(patch?.head).toBe((await stateJson(ctx)).head);
    expect(patch?.upsert.issues?.map((i) => i.id)).toEqual([id]);
    expect(patch?.remove).toEqual({});
    expect(c.events.at(-1)?.id).toBe(`${BOOT}:1`);
  });

  test('a hand edit is a patch, backe commit after it none', async () => {
    const id = await create('Vorher');
    const live = await start();
    const c = collect(live);
    await retitle(id, 'Vorher', 'Nachher');
    await tick(live);
    expect(c.patches()).toHaveLength(1);
    expect(c.patches()[0]?.upsert.issues?.[0]?.title).toBe('Nachher');
    expect(c.patches()[0]).not.toHaveProperty('actors');
    await commitEdits(ctx, {});
    await tick(live);
    expect(c.patches()).toHaveLength(1);
    expect(live.head).toBe((await stateJson(ctx)).head);
  });

  test('a body edit is a touch', async () => {
    const id = await create('Mit Body');
    const live = await start();
    const c = collect(live);
    await writeOp(ctx, {
      op: 'issue.edit',
      id,
      body: { from_hash: bodyHash(''), to: 'Neue Beschreibung\n' },
    });
    await tick(live);
    expect(c.patches()).toEqual([
      { rev: 1, head: live.head, upsert: {}, remove: {}, touched: [id], actors: { [id]: ['spw'] } },
    ]);
  });

  test('a patch names the actors of its issues', async () => {
    const live = await start();
    const c = collect(live);
    const id = await create('Von spw');
    await tick(live);
    expect(c.patches()[0]?.actors).toEqual({ [id]: ['spw'] });
  });

  test('a deleted issue is a remove', async () => {
    const id = await create('Weg damit');
    const live = await start();
    const c = collect(live);
    await writeOp(ctx, { op: 'issue.delete', id });
    await tick(live);
    expect(c.patches()).toHaveLength(1);
    expect(c.patches()[0]?.remove).toEqual({ issues: [id] });
  });

  test('comments and attachments mark the issue touched', async () => {
    const id = await create('Mit Kommentar');
    const live = await start();
    const c = collect(live);
    await writeOp(ctx, { op: 'comment.add', id, body: 'Hallo\n' });
    await tick(live);
    // Ref-Runde und Arbeitsbaum-Runde sehen denselben Kommentar; gemeldet wird er einmal.
    expect(c.patches().map((p) => p.touched)).toEqual([[id]]);
    await writeOp(ctx, { op: 'comment.add', id, body: 'Noch einer\n' });
    await tick(live);
    await addAttachment(ctx, id, {
      name: 'a.txt',
      source: { kind: 'file', fileName: 'a.txt', content: Buffer.from('x') },
    });
    await tick(live);
    expect(c.patches().map((p) => p.touched)).toEqual([[id], [id], [id]]);
  });

  test('a hand written comment is touched once, backe commit after it adds nothing', async () => {
    const id = await create('Kommentar per Hand');
    const live = await start();
    const c = collect(live);
    const dir = join(b.root, commentsDir(id));
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, '20261126T100000Z-spw-a1b.md'),
      '---\nauthor: spw\ncreated: 2026-11-26T10:00:00Z\n---\nPer Hand\n',
    );
    await tick(live);
    expect(c.patches().map((p) => p.touched)).toEqual([[id]]);
    // Ein zweiter in dasselbe, nun schon bestehende Verzeichnis.
    await writeFile(
      join(dir, '20261126T110000Z-spw-c2d.md'),
      '---\nauthor: spw\ncreated: 2026-11-26T11:00:00Z\n---\nNoch einer\n',
    );
    await tick(live);
    expect(c.patches().map((p) => p.touched)).toEqual([[id], [id]]);
    await commitEdits(ctx, {});
    await tick(live);
    expect(c.patches()).toHaveLength(2);
  });

  test('a broken hand edit becomes a problem, the fix a patch', async () => {
    const id = await create('Heil');
    const live = await start();
    const c = collect(live);
    const file = join(b.root, issueFile(id));
    const good = await readFile(file, 'utf8');
    await writeFile(file, '---\ntitle: [kaputt\n---\n');
    await tick(live);
    expect(c.patches()).toHaveLength(1);
    expect(c.patches()[0]?.remove).toEqual({ issues: [id] });
    expect(c.patches()[0]?.problems?.map((p) => p.path)).toEqual([issueFile(id)]);
    await writeFile(file, good.replace('title: Heil', 'title: Wieder heil'));
    await tick(live);
    expect(c.patches()).toHaveLength(2);
    expect(c.patches()[1]?.upsert.issues?.[0]?.title).toBe('Wieder heil');
    expect(c.patches()[1]?.problems).toEqual([]);
  });

  test('a broken config keeps the last state until it is fixed', async () => {
    const id = await create('Bleibt');
    const live = await start();
    const c = collect(live);
    const config = join(b.root, BACKLOG_CONFIG);
    const good = await readFile(config, 'utf8');
    await writeFile(config, '{ kaputt');
    await retitle(id, 'Bleibt', 'Neu');
    await tick(live);
    expect(c.patches()).toEqual([]);
    await writeFile(config, good);
    await tick(live);
    expect(c.patches()).toHaveLength(1);
    expect(c.patches()[0]?.upsert.issues?.[0]?.title).toBe('Neu');
  });

  test('sync state changes become sync events', async () => {
    const live = await start();
    const c = collect(live);
    const syncEvents = () => c.events.filter((e) => e.event === 'sync');
    const error = { code: 'sync', message: 'Netz weg', at: '2026-11-26T10:00:00Z' } as const;
    await writeSyncState(b.root, { last_error: error });
    await tick(live);
    expect(syncEvents()).toHaveLength(2);
    expect(c.events.at(-1)?.data).toMatchObject({ last_error: { message: 'Netz weg' } });
    const count = c.events.length;
    await writeSyncState(b.root, { last_error: error });
    await tick(live);
    expect(c.events).toHaveLength(count);
  });

  test('patches converge to a fresh state after a burst', async () => {
    // Mehrere Ref-Bewegungen zwischen zwei Blicken, gepackte Refs, zuletzt ein Wechsel des Branches
    // per Hand: Der Client-Zustand aus `hello` und allen Patches ist danach ein frischer `/state`.
    await create('Vorlauf');
    const live = await start();
    const initial = await stateJson(ctx, live.rev);
    const c = collect(live);
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      if (i % 3 === 2) {
        const id = ids.at(-1) as string;
        await writeOp(ctx, { op: 'issue.move', id, from: 'todo', to: 'in_progress' });
      } else {
        ids.push(await create(`Burst ${i}`));
      }
      if (i === 3) await git(['pack-refs', '--all'], { cwd: b.root });
      if (i % 3 === 2) await tick(live);
    }
    await tick(live);
    expect(c.patches().length).toBeGreaterThan(1);
    expect(c.patches().length).toBeLessThan(8);
    const folded = () => comparable(c.patches().reduce(applyPatch, initial));
    expect(folded()).toEqual(comparable(await stateJson(ctx)));
    await git(['checkout', '-q', '-b', 'seitlich', 'HEAD~3'], { cwd: b.root });
    await tick(live);
    const fresh = await stateJson(ctx);
    expect(live.head).toBe(fresh.head);
    expect(folded()).toEqual(comparable(fresh));
  });

  test('reconnect with a last event id replays missed patches', async () => {
    const live = await start();
    const first = collect(live);
    await create('Eins');
    await tick(live);
    expect(first.patches()).toHaveLength(1);
    first.off();
    await create('Zwei');
    await tick(live);
    await create('Drei');
    await tick(live);
    expect(live.rev).toBe(3);
    const again = collect(live, `${BOOT}:1`);
    expect(again.names()).toEqual(['hello', 'patch', 'patch', 'sync']);
    expect(again.patches().map((p) => p.rev)).toEqual([2, 3]);
    expect(collect(live, `${BOOT}:3`).names()).toEqual(['hello', 'sync']);
  });
});

test('events that arrive late add nothing', async () => {
  // Kommt das Ref-Ereignis eines Writes erst nach dem Arbeitsbaum (oder umgekehrt), entsteht der
  // Patch aus dem ersten; das zweite zeigt nichts Neues mehr.
  const live = await start();
  const c = collect(live);
  const { gitDir } = await gitDirs(b.root);
  const inGit = (path: string) => path === gitDir || path.startsWith(`${gitDir}/`);
  await create('Ref zuerst');
  fw.flush(inGit);
  await settle(live);
  expect(c.patches()).toHaveLength(1);
  expect(c.patches()[0]?.head).toBe(await revParse(b.root, 'HEAD'));
  await tick(live);
  expect(c.patches()).toHaveLength(1);

  const id = await create('Baum zuerst');
  fw.flush((path) => !inGit(path));
  await settle(live);
  expect(c.patches()).toHaveLength(2);
  expect(c.patches()[1]?.upsert.issues?.map((i) => i.id)).toEqual([id]);
  await tick(live);
  expect(c.patches()).toHaveLength(2);
  expect(live.head).toBe(await revParse(b.root, 'HEAD'));
});

test('a new comments dir reported after the ref round adds no touch', async () => {
  // inotify meldet das neue Verzeichnis `comments/` mit; kommt es erst nach der Ref-Runde an,
  // zählt es nicht noch einmal.
  const id = await create('Mit Kommentar');
  const live = await start();
  const c = collect(live);
  await writeOp(ctx, { op: 'comment.add', id, body: 'Hallo\n' });
  const { gitDir } = await gitDirs(b.root);
  fw.flush((path) => path.startsWith(gitDir));
  await settle(live);
  await tick(live);
  expect(c.patches().map((p) => p.touched)).toEqual([[id]]);
});

test('actors travel along when a round fails after head moved', async () => {
  const id = await create('Vorher');
  const live = await start({ watch: deaf });
  const c = collect(live);
  const file = join(b.root, issueFile(id));
  const config = join(b.root, BACKLOG_CONFIG);
  const issue = await readFile(file, 'utf8');
  const good = await readFile(config, 'utf8');
  // Ein Commit mit kaputter Config: HEAD bewegt sich, aber das Neuladen scheitert.
  await rawCommit(b.root, {
    files: {
      [issueFile(id)]: issue.replace('title: Vorher', 'title: Nachher'),
      [BACKLOG_CONFIG]: '{ kaputt',
    },
    actor: 'claude-1',
    op: 'issue.edit',
  });
  await safetyNet(live);
  // Die Runde hat den neuen HEAD gesehen, das Neuladen scheiterte an der kaputten Config.
  expect(live.head).toBe(await revParse(b.root, 'HEAD'));
  expect(c.patches()).toEqual([]);
  // Der Fix-Commit fasst kein Issue an; die Actors des gescheiterten Commits kommen mit.
  await rawCommit(b.root, { files: { [BACKLOG_CONFIG]: good }, actor: 'spw', op: 'config.edit' });
  await safetyNet(live);
  expect(c.patches()).toHaveLength(1);
  expect(c.patches()[0]?.upsert.issues?.[0]?.title).toBe('Nachher');
  expect(c.patches()[0]?.actors).toEqual({ [id]: ['claude-1'] });
});

test('actors are cleared after a comparison without a patch', async () => {
  const id = await create('Vorher');
  const live = await start({ watch: deaf });
  const c = collect(live);
  const file = join(b.root, issueFile(id));
  const issue = await readFile(file, 'utf8');
  // Änderung und Rücknahme in einer Runde: HEAD bewegt sich, der sichtbare Stand bleibt gleich.
  await rawCommit(b.root, {
    files: { [issueFile(id)]: issue.replace('title: Vorher', 'title: Zwischen') },
    actor: 'claude-1',
    op: 'issue.edit',
  });
  await rawCommit(b.root, {
    files: { [issueFile(id)]: issue },
    actor: 'claude-1',
    op: 'issue.edit',
  });
  await safetyNet(live);
  // Die Runde hat den neuen HEAD gesehen (und seine Actors gesammelt), aber keinen Patch ergeben.
  expect(live.head).toBe((await stateJson(ctx)).head);
  expect(c.patches()).toEqual([]);
  await writeFile(file, issue.replace('title: Vorher', 'title: Handgemacht'));
  await safetyNet(live);
  expect(c.patches()).toHaveLength(1);
  expect(c.patches()[0]?.upsert.issues?.[0]?.title).toBe('Handgemacht');
  expect(c.patches()[0]).not.toHaveProperty('actors');
});

test('an atomic write reloads by delta, a temp file is no event', async () => {
  const id = await create('Atomar');
  const live = await start();
  const c = collect(live);
  const full = vi.spyOn(snapshotModule, 'loadSnapshot');
  try {
    const file = join(b.root, issueFile(id));
    const issues = join(b.root, 'issues');
    // inotify meldet auch die Temp-Datei, über die `writeFileAtomic` schreibt; sie zählt nicht.
    fw.emit(issues, relative(issues, atomicTempPath(file)));
    await settle(live);
    expect(c.patches()).toEqual([]);
    await writeFileAtomic(
      file,
      (await readFile(file, 'utf8')).replace('title: Atomar', 'title: Neu'),
    );
    await tick(live);
    expect(c.patches()).toHaveLength(1);
    expect(full).not.toHaveBeenCalled();
  } finally {
    full.mockRestore();
  }
});

test('a change before the watchers stand is not lost', async () => {
  const id = await create('Vorher');
  const file = join(b.root, issueFile(id));
  const original = await readFile(file, 'utf8');
  // Der Hand-Edit fällt in das Fenster, in dem der Watcher noch aufgebaut wird.
  const live = await start({
    watch: (path, opts, listener) => {
      if (path === b.root) writeFileSync(file, original.replace('title: Vorher', 'title: Fenster'));
      return fw.watch(path, opts, listener);
    },
  });
  await tick(live);
  const c = collect(live);
  await writeFile(file, original);
  await tick(live);
  expect(c.patches()).toHaveLength(1);
  expect(c.patches()[0]?.upsert.issues?.[0]?.title).toBe('Vorher');
});

test('the initial sync state is read after HEAD', async () => {
  b = await testBacklog({ remote: true });
  ctx = await b.context();
  const real = stateModule.syncJson;
  // Ein Commit direkt nach dem ersten Blick auf den Sync-Zustand: Läse der Start `HEAD` erst
  // danach, stünde in `hello` ein Commit, den `unpushed` nicht zählt, und keine Runde holte das nach.
  const spy = vi.spyOn(stateModule, 'syncJson').mockImplementationOnce(async (c) => {
    const json = await real(c);
    await create('Dazwischen');
    return json;
  });
  try {
    const live = await start();
    const head = live.head;
    const c = collect(live);
    expect(c.events[0]).toMatchObject({ event: 'hello', data: { head } });
    const sync = c.events.find((e) => e.event === 'sync')?.data as { unpushed: number };
    const { stdout } = await git(['rev-list', '--count', `refs/remotes/origin/main..${head}`], {
      cwd: b.root,
    });
    expect(spy).toHaveBeenCalled();
    expect(sync.unpushed).toBe(Number(stdout.trim()));
  } finally {
    spy.mockRestore();
  }
});

test('a failed start leaves no watcher or timer', async () => {
  await writeFile(join(b.root, BACKLOG_CONFIG), '{ kaputt');
  await expect(
    LiveBacklog.start(ctx, { boot: BOOT, rev: 0, deps: { watch: fw.watch } }),
  ).rejects.toThrow();
  expect(fw.watches.length).toBeGreaterThan(0);
  expect(fw.watches.every((w) => w.closed)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test.each([
  ['its own name', 'packed-refs'],
  ['the name of the git dir', 'git dir'],
  ['no name', null],
])('packed refs still move the head when the git dir reports %s', async (_what, reported) => {
  // Nur das Git-Dir meldet sich, wenn `pack-refs` den Ref aus `refs/heads/` nimmt.
  const live = await start();
  fw.mute(() => true);
  const c = collect(live);
  await create('Gepackt');
  await tick(live);
  expect(c.patches()).toEqual([]);
  await git(['pack-refs', '--all'], { cwd: b.root });
  const { commonDir } = await gitDirs(b.root);
  fw.emit(commonDir, reported === 'git dir' ? basename(commonDir) : reported);
  await settle(live);
  expect(c.patches()).toHaveLength(1);
  expect(live.head).toBe(await revParse(b.root, 'HEAD'));
});

test('the safety net catches a lost event', async () => {
  const live = await start({ watch: deaf });
  const c = collect(live);
  await create('Verloren');
  await settle(live);
  expect(c.patches()).toEqual([]);
  await safetyNet(live);
  expect(c.patches()).toHaveLength(1);
});

test('the safety net catches a lost hand edit and its revert', async () => {
  const id = await create('Original');
  const live = await start({ watch: deaf });
  const c = collect(live);
  const file = join(b.root, issueFile(id));
  const original = await readFile(file, 'utf8');
  await writeFile(file, original.replace('title: Original', 'title: Verloren'));
  await settle(live);
  expect(c.patches()).toEqual([]);
  await safetyNet(live);
  expect(c.patches()).toHaveLength(1);
  expect(c.patches()[0]?.upsert.issues?.[0]?.title).toBe('Verloren');
  await writeFile(file, original);
  await safetyNet(live);
  expect(c.patches()).toHaveLength(2);
  expect(c.patches()[1]?.upsert.issues?.[0]?.title).toBe('Original');
  // Ohne Änderung findet das Netz nichts.
  await safetyNet(live);
  expect(c.patches()).toHaveLength(2);
});

test('a foreign, future or broken event id gets reset', async () => {
  const live = await start();
  for (const id of ['ffffffff:0', `${BOOT}:7`, 'kaputt']) {
    expect(collect(live, id).names()).toEqual(['hello', 'reset', 'sync']);
  }
});

test('an event id outside the buffer gets reset', async () => {
  const id = await create('Oft');
  const live = await start({ rev: 5 });
  expect(collect(live, `${BOOT}:4`).names()).toEqual(['hello', 'reset', 'sync']);
  const c = collect(live);
  const issues = join(b.root, 'issues');
  const file = join(b.root, issueFile(id));
  const text = await readFile(file, 'utf8');
  for (let i = 0; i <= LIVE_TIMING.buffer; i++) {
    await writeFile(file, text.replace('title: Oft', `title: Oft ${i}`));
    fw.emit(issues, relative(issues, file));
    await settle(live);
  }
  expect(c.patches()).toHaveLength(LIVE_TIMING.buffer + 1);
  expect(live.rev).toBe(5 + LIVE_TIMING.buffer + 1);
  expect(collect(live, `${BOOT}:5`).names()).toEqual(['hello', 'reset', 'sync']);
  expect(collect(live, `${BOOT}:6`).patches()).toHaveLength(LIVE_TIMING.buffer);
});

test('the watcher ends 30 s after the last subscriber', async () => {
  const onStop = vi.fn();
  const live = await start({ rev: 3, onStop });
  const c = collect(live);
  c.off();
  c.off();
  await vi.advanceTimersByTimeAsync(LIVE_TIMING.lingerMs - 1);
  const again = collect(live);
  await vi.advanceTimersByTimeAsync(LIVE_TIMING.lingerMs);
  expect(onStop).not.toHaveBeenCalled();
  again.off();
  await vi.advanceTimersByTimeAsync(LIVE_TIMING.lingerMs);
  expect(onStop).toHaveBeenCalledWith(3);
  expect(live.stopped).toBe(true);
  expect(fw.watches.every((w) => w.closed)).toBe(true);
  await create('Niemand schaut');
  await tick(live);
  expect(live.rev).toBe(3);
});

test('a throwing subscriber loses only itself', async () => {
  const live = await start();
  live.subscribe((e) => {
    if (e.event === 'patch') throw new Error('weg');
  });
  const c = collect(live);
  await create('Eins');
  await tick(live);
  expect(c.patches()).toHaveLength(1);
  expect(live.subscribers()).toBe(1);
});

test('periodic sync runs at pull_interval while watched', async () => {
  b = await testBacklog({ remote: true });
  await setPullInterval(b, 60);
  ctx = await b.context();
  const scheduled = vi.spyOn(backgroundModule, 'scheduleSync');
  try {
    const spawn = vi.fn();
    const live = await LiveBacklog.start(ctx, {
      boot: BOOT,
      rev: 0,
      deps: { watch: fw.watch, sync: { spawn } },
    });
    running.push(live);
    collect(live);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(scheduled).toHaveBeenCalledTimes(1);
    expect(await scheduled.mock.results[0]?.value).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    await live.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(spawn).toHaveBeenCalledTimes(1);
  } finally {
    scheduled.mockRestore();
  }
});

describe('neighbours', () => {
  /** Ein Hintergrund-Sync, der in-process läuft, statt einen Prozess zu starten. */
  const inProcess = (c: () => ResolvedContext) =>
    vi.fn(() => {
      syncs.push(runBackground(c(), { spawn: () => {} }));
    });

  const manual = (c: ResolvedContext): ResolvedContext => ({
    ...c,
    userConfig: {
      ...c.userConfig,
      backlogs: { acme: { ...c.userConfig.backlogs?.acme, sync: { mode: 'manual' } } },
    },
  });

  const backlogDir = () => join(b.homes.backeHome, 'backlogs', 'acme');

  /**
   * Der Agent `claude-1` mit Push-Rechten und eigener Arbeitskopie; sie legt den Hub an und hängt
   * die Arbeitskopie von spw daran. Mit `pullInterval` steht der Takt des periodischen Syncs fest.
   */
  async function withAgent(pullInterval?: number): Promise<{ agentCtx: ResolvedContext }> {
    if (pullInterval !== undefined) await setPullInterval(b, pullInterval);
    const claude = await testKey('claude-1');
    await executeWrite(await b.context(), {
      kind: 'op',
      op: {
        op: 'user.add',
        handle: 'claude-1',
        name: 'Claude',
        kind: 'agent',
        operator: 'spw',
        keys: [claude.line],
      },
    });
    await setIdentity(b.homes, 'acme', 'claude-1', claude.priv);
    const { root: wc } = await ensureWorkingCopy(await b.context({ as: 'claude-1' }), 'claude-1');
    ctx = await b.context();
    return { agentCtx: await b.context({ as: 'claude-1' }, wc) };
  }

  async function agentPush(agentCtx: ResolvedContext, title = 'Vom Agent'): Promise<string> {
    const id = await writeOp(agentCtx, { op: 'issue.create', title, state: 'todo' });
    await syncNow(agentCtx, { spawn: () => {} });
    return id;
  }

  async function startWith(c: ResolvedContext, deps: LiveDeps): Promise<LiveBacklog> {
    const live = await LiveBacklog.start(c, {
      boot: BOOT,
      rev: 0,
      deps: { watch: fw.watch, ...deps },
    });
    running.push(live);
    return live;
  }

  /**
   * Meldet die Änderungen, lässt die Nachbar-Entprellung ablaufen und wartet Blick und
   * Sync-Prüfung ab, dann die in-process gestarteten Syncs; danach meldet es, was die in der eigenen
   * Arbeitskopie bewegt haben.
   */
  async function quiet(live: LiveBacklog): Promise<void> {
    fw.flush();
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.neighborMs);
    await live.idle();
    await Promise.all(syncs);
    await tick(live);
  }

  /** Faltet die Patches auf den Anfangsstand und vergleicht mit einem frischen Stand. */
  async function converged(live: LiveBacklog, initial: StateJson, c: ReturnType<typeof collect>) {
    const fresh = await stateJson(ctx);
    expect(live.head).toBe(fresh.head);
    expect(comparable(c.patches().reduce(applyPatch, initial))).toEqual(comparable(fresh));
  }

  test('a neighbour write arrives as a patch without waiting for pull_interval', async () => {
    const { agentCtx } = await withAgent(3600);
    const spawn = inProcess(() => ctx);
    const live = await startWith(ctx, { sync: { spawn } });
    const c = collect(live);
    const id = await agentPush(agentCtx);
    await quiet(live);
    const [patch] = c.patches();
    expect(c.patches()).toHaveLength(1);
    expect(patch?.upsert.issues?.map((i) => [i.id, i.title])).toEqual([[id, 'Vom Agent']]);
    expect(patch?.actors).toEqual({ [id]: ['claude-1'] });
    expect(live.head).toBe(await revParse(agentCtx.backlog.workingCopy as string, 'HEAD'));
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test('a neighbour ahead at start starts one sync, and its issue arrives as a patch', async () => {
    const { agentCtx } = await withAgent(3600);
    const id = await agentPush(agentCtx);
    const spawn = vi.fn();
    const live = await startWith(ctx, { sync: { spawn } });
    const c = collect(live);
    // Schon der erste Blick der Nachbar-Watch beim Start meldet den Vorsprung, ohne Entprellung.
    await live.idle();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(c.patches()).toEqual([]);

    // Der Sync, den `spawn` gestartet hätte, läuft hier in-process.
    await runBackground(ctx, { spawn: () => {} });
    await quiet(live);
    const [patch] = c.patches();
    expect(c.patches()).toHaveLength(1);
    expect(patch?.upsert.issues?.map((i) => [i.id, i.title])).toEqual([[id, 'Vom Agent']]);
    expect(patch?.actors).toEqual({ [id]: ['claude-1'] });
    expect(live.head).toBe(await revParse(agentCtx.backlog.workingCopy as string, 'HEAD'));
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test('manual mode starts no neighbour sync', async () => {
    const { agentCtx } = await withAgent();
    const scheduled = vi.spyOn(scheduleModule, 'scheduleSync');
    try {
      const spawn = vi.fn();
      const live = await startWith(manual(ctx), { sync: { spawn } });
      await agentPush(agentCtx);
      await quiet(live);
      // Die Bewegung kommt an; ob sie einen Sync startet, entscheidet `scheduleSync`.
      expect(scheduled).toHaveBeenCalledWith(expect.anything(), 'periodic', expect.anything());
      expect(await scheduled.mock.results[0]?.value).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      scheduled.mockRestore();
    }
  });

  test.each(PROFILES)(
    'neighbour pushes converge to a fresh state after a burst, reported like %s',
    async (profile) => {
      fw = fakeWatcher(profile);
      const { agentCtx } = await withAgent(3600);
      const agentWc = agentCtx.backlog.workingCopy as string;
      const spawn = inProcess(() => ctx);
      const live = await startWith(ctx, { sync: { spawn } });
      const initial = await stateJson(ctx, live.rev);
      const c = collect(live);
      // Je Phase zwei Pushes, ohne dass dazwischen ein Ereignis ankommt: Der Blick danach sieht nur
      // den letzten Stand und startet genau einen Sync. Gepusht wird direkt per `git push`, der Ref
      // im Hub bewegt sich wie nach einem Sync des Agenten.
      for (let phase = 1; phase <= 3; phase++) {
        const id = await writeOp(agentCtx, {
          op: 'issue.create',
          title: `Burst ${phase}`,
          state: 'todo',
        });
        await git(['push', '-q', 'origin', 'HEAD:main'], { cwd: agentWc });
        await writeOp(agentCtx, { op: 'issue.move', id, from: 'todo', to: 'in_progress' });
        await git(['push', '-q', 'origin', 'HEAD:main'], { cwd: agentWc });
        await quiet(live);
        expect(spawn).toHaveBeenCalledTimes(phase);
        expect(live.head).toBe(await revParse(agentWc, 'HEAD'));
        if (phase === 1) {
          // Zwischen zwei Phasen packt der Hub seine Refs: Der Wert bleibt, ein Sync folgt nicht.
          await git(['pack-refs', '--all'], { cwd: join(backlogDir(), 'hub.git') });
          await quiet(live);
          expect(spawn).toHaveBeenCalledTimes(phase);
        }
      }
      expect(c.patches()).toHaveLength(3);
      await converged(live, initial, c);
    },
  );

  test('two neighbour pushes before a quiet phase start one sync', async () => {
    const { agentCtx } = await withAgent(3600);
    const spawn = inProcess(() => ctx);
    const live = await startWith(ctx, { sync: { spawn } });
    const initial = await stateJson(ctx, live.rev);
    const c = collect(live);
    // Beide Pushes sind fertig, bevor die Zeit läuft: Der erste Blick sieht schon den zweiten Stand.
    const ids = [await agentPush(agentCtx, 'Erster'), await agentPush(agentCtx, 'Zweiter')];
    await quiet(live);
    await converged(live, initial, c);
    const arrived = c.patches().flatMap((p) => p.upsert.issues?.map((i) => i.id) ?? []);
    expect(arrived).toEqual(expect.arrayContaining(ids));
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test('a neighbour push during a running sync is fetched by its dirty re-run', async () => {
    const { agentCtx } = await withAgent(3600);
    let fetched!: () => void;
    const paused = new Promise<void>((resolve) => {
      fetched = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runs: Promise<{ rounds: number; deferred: boolean }>[] = [];
    // Der erste Sync hält nach seinem Fetch an, mit `sync.lock`; der zweite findet ihn gehalten.
    const spawn = vi.fn(() => {
      const hooks =
        runs.length === 0
          ? {
              afterFetch: async () => {
                fetched();
                await gate;
              },
            }
          : {};
      const run = runBackground(ctx, { spawn: () => {}, hooks });
      runs.push(run);
      syncs.push(run);
    });
    const live = await startWith(ctx, { sync: { spawn } });
    const initial = await stateJson(ctx, live.rev);
    const c = collect(live);

    await agentPush(agentCtx, 'Vor dem Sync');
    fw.flush();
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.neighborMs);
    await live.idle();
    expect(spawn).toHaveBeenCalledTimes(1);
    await paused;
    await agentPush(agentCtx, 'Während des Syncs');
    fw.flush();
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.neighborMs);
    await live.idle();
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(await runs[1]).toEqual({ rounds: 0, deferred: true });

    release();
    expect(await runs[0]).toEqual({ rounds: 2, deferred: false });
    await quiet(live);
    await converged(live, initial, c);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  test('a failed start waits for a sync check its neighbour watch began', async () => {
    const { agentCtx } = await withAgent();
    await agentPush(agentCtx);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let checking!: () => void;
    const checked = new Promise<void>((resolve) => {
      checking = resolve;
    });
    // Der Vorsprung des Agenten meldet sich schon beim Start; die Prüfung dazu hängt am Tor.
    const scheduled = vi.spyOn(scheduleModule, 'scheduleSync').mockImplementation(() => {
      checking();
      return gate.then(() => false);
    });
    let loading!: () => void;
    const loaded = new Promise<void>((resolve) => {
      loading = resolve;
    });
    const load = vi.spyOn(snapshotModule, 'loadSnapshot').mockImplementationOnce(async () => {
      loading();
      throw new Error('kaputt');
    });
    try {
      let settled = false;
      const started = LiveBacklog.start(ctx, {
        boot: BOOT,
        rev: 0,
        deps: { watch: fw.watch, sync: { spawn: vi.fn() } },
      });
      const outcome = started.then(
        () => 'resolved',
        (err: unknown) => {
          settled = true;
          return err;
        },
      );
      await checked;
      expect(scheduled).toHaveBeenCalledTimes(1);
      // Die Prüfung hängt; der Start lädt weiter, scheitert am Snapshot und wartet dann auf sie.
      await loaded;
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);

      release();
      expect(await outcome).toMatchObject({ message: 'kaputt' });
    } finally {
      scheduled.mockRestore();
      load.mockRestore();
    }
  });

  test('stop waits until the neighbour watch is closed', async () => {
    await withAgent();
    const live = await startWith(ctx, { sync: { spawn: vi.fn() } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = NeighborWatch.prototype.close;
    const close = vi.spyOn(NeighborWatch.prototype, 'close').mockImplementation(function (
      this: NeighborWatch,
    ) {
      return original.call(this).then(() => gate);
    });
    try {
      let stopped = false;
      const stopping = live.stop().then(() => {
        stopped = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(close).toHaveBeenCalledTimes(1);
      expect(stopped).toBe(false);
      release();
      await stopping;
      expect(stopped).toBe(true);
    } finally {
      close.mockRestore();
    }
  });

  test('the safety net catches a lost neighbour push', async () => {
    const { agentCtx } = await withAgent();
    const dir = backlogDir();
    const spawn = vi.fn();
    // Alles unter dem Backlog-Verzeichnis bleibt stumm: Nachbarn, Hub und die eigene Arbeitskopie.
    fw.mute((path) => path === dir || path.startsWith(`${dir}/`));
    const live = await startWith(ctx, { sync: { spawn } });
    await agentPush(agentCtx);
    await quiet(live);
    expect(spawn).not.toHaveBeenCalled();
    await safetyNet(live);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test('a stopped watcher starts no neighbour sync', async () => {
    const { agentCtx } = await withAgent();
    const spawn = vi.fn();
    const scheduled = vi.spyOn(scheduleModule, 'scheduleSync');
    try {
      const live = await startWith(ctx, { sync: { spawn } });
      collect(live);
      const timers = vi.getTimerCount();
      await agentPush(agentCtx);
      // Der Push kommt bei der Nachbar-Watch an; ihre Entprellung läuft, wenn der Watcher endet.
      fw.flush();
      expect(vi.getTimerCount()).toBe(timers + 1);
      await live.stop();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(LIVE_TIMING.safetyMs);
      expect(scheduled).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      scheduled.mockRestore();
    }
  });

  test('a neighbour sync that becomes due after stop starts nothing', async () => {
    const { agentCtx } = await withAgent();
    const spawn = vi.fn();
    const live = await startWith(ctx, { sync: { spawn } });
    const real = scheduleModule.scheduleSync;
    const scheduled = vi.spyOn(scheduleModule, 'scheduleSync');
    let started: Promise<boolean> | undefined;
    let stopped: Promise<void> | undefined;
    // Der Watcher endet, während `scheduleSync` noch prüft, ob ein Start fällig ist.
    scheduled.mockImplementationOnce((c, reason, deps) => {
      stopped = live.stop();
      started = real(c, reason, deps);
      return started;
    });
    try {
      await agentPush(agentCtx);
      await quiet(live);
      expect(stopped).toBeDefined();
      await stopped;
      // Fällig war der Start; erst der beendete Watcher hält ihn zurück.
      expect(await started).toBe(true);
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      scheduled.mockRestore();
    }
  });
});

describe('LiveHub', () => {
  const hubOf = () => new LiveHub({ boot: BOOT, deps: { watch: fw.watch } });

  test('acquire shares one watcher, a restart continues after the last rev', async () => {
    const hub = hubOf();
    expect(hub.boot).toBe(BOOT);
    expect(new LiveHub().boot).toMatch(/^[0-9a-f]{8}$/);
    const ctxFn = () => b.context();
    const [l1, l2] = await Promise.all([hub.acquire('acme', ctxFn), hub.acquire('acme', ctxFn)]);
    expect(l1).toBe(l2);
    const c = collect(l1);
    await create('Eins');
    await tick(l1);
    expect(hub.revOf('acme')).toBe(1);
    c.off();
    // Eine Runde läuft, wenn die Frist abläuft: Der Watcher verlässt den Hub trotzdem sofort.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = actorsModule.issueActors;
    let entered!: () => void;
    const inRound = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = vi.spyOn(actorsModule, 'issueActors').mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return real(...args);
    });
    try {
      await create('Während des Endes');
      fw.flush();
      await inRound;
      await vi.advanceTimersByTimeAsync(LIVE_TIMING.lingerMs);
      expect(l1.stopped).toBe(true);
      const l3 = await hub.acquire('acme', ctxFn);
      expect(l3).not.toBe(l1);
      expect(l3.rev).toBe(2);
      expect(hub.revOf('acme')).toBe(2);
      expect(collect(l3, `${BOOT}:1`).names()).toEqual(['hello', 'reset', 'sync']);
    } finally {
      release();
      held.mockRestore();
    }
    await l1.idle();
    expect(l1.rev).toBe(1);
    await hub.close();
  });

  test('revOf is 0 for an unknown backlog, a failed start is not kept', async () => {
    const hub = hubOf();
    expect(hub.revOf('acme')).toBe(0);
    await expect(
      hub.acquire('acme', () => Promise.reject(new Error('kein Kontext'))),
    ).rejects.toThrow('kein Kontext');
    const live = await hub.acquire('acme', () => b.context());
    expect(live.rev).toBe(0);
    await hub.close();
  });

  test('a watcher started after close stops at once', async () => {
    const hub = hubOf();
    await hub.close();
    const live = await hub.acquire('acme', () => b.context());
    collect(live);
    await create('Zu spät');
    await tick(live);
    expect(live.rev).toBe(0);
    expect(live.subscribers()).toBe(1);
  });
});
