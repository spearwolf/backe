import { testBacklog } from '../../../test/helpers/git.ts';
import type { CliIo } from '../io.ts';
import { run } from '../run.ts';
import { browserCommand } from './ui.ts';

test.each([
  ['linux', 'xdg-open'],
  ['darwin', 'open'],
  ['win32', undefined],
  ['freebsd', undefined],
] as const)('browserCommand on %s is %s', (platform, cmd) => {
  expect(browserCommand(platform)).toBe(cmd);
});

test('signal handlers are in place when the start line is written', async () => {
  const b = await testBacklog();
  const before = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') };
  let atStart: typeof before | undefined;
  let resolveStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const io: CliIo = {
    argv: ['ui', '--port', '0'],
    env: { ...b.env, BACKE_USER: 'spw', NO_COLOR: '1' },
    cwd: b.root,
    stdout: (s) => {
      if (!s.startsWith('backe ui: ')) return;
      atStart = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') };
      resolveStarted();
    },
    stdoutBytes: () => {},
    stderr: () => {},
    readStdin: async () => '',
    isTTY: false,
    stdinIsTTY: false,
    runEditor: async () => 0,
    prompt: async () => '',
  };
  const exit = run(io);
  // Scheitert `run` vor der Startzeile, soll der Test sofort mit dem Exit-Code scheitern, nicht
  // erst im Timeout.
  await Promise.race([
    started,
    exit.then((code) => {
      throw new Error(`backe ui endete vor der Startzeile mit Exit-Code ${code}`);
    }),
  ]);
  // Kein echtes Signal: `emit` ruft nur die Listener, die der Befehl registriert hat.
  process.emit('SIGTERM');
  expect(await exit).toBe(0);
  expect(atStart).toEqual({ int: before.int + 1, term: before.term + 1 });
  expect({
    int: process.listenerCount('SIGINT'),
    term: process.listenerCount('SIGTERM'),
  }).toEqual(before);
});
