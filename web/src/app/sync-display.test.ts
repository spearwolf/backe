import { syncLineParts } from '@backe/core/sync-line.ts';
import { syncDisplay } from './sync-display.ts';

/** Wie das JSON von `sync status`. */
function status(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    remote: 'git@example.org:team/backlog.git',
    mode: 'auto',
    unpushed: 0,
    last_attempt: null,
    last_success: null,
    last_error: null,
    running: false,
    conflicts: [],
    ...over,
  };
}

test('no working copy shows nothing', () => {
  expect(syncDisplay(null, 'open')).toEqual({ kind: 'none' });
  expect(syncDisplay(null, 'connecting')).toEqual({ kind: 'none' });
});

test('offline wins', () => {
  const failing = status({ unpushed: 2, last_error: { message: 'boom' }, conflicts: [{}] });
  expect(syncDisplay(failing, 'offline')).toEqual({ kind: 'offline' });
  expect(syncDisplay(status(), 'offline')).toEqual({ kind: 'offline' });
  // Ohne Verbindung zum Server ist auch ohne Arbeitskopie alles Gezeigte womöglich veraltet.
  expect(syncDisplay(null, 'offline')).toEqual({ kind: 'offline' });
});

test('open parts follow syncLineParts', () => {
  const cases = [
    status({ unpushed: 3, mode: 'manual' }),
    status({ unpushed: 2, last_error: { message: 'push rejected' } }),
    status({ conflicts: [{}, {}] }),
    status({ unpushed: 1, mode: 'manual', conflicts: [{}], last_error: { message: 'x' } }),
  ];
  for (const sync of cases) {
    const parts = syncLineParts(sync as Parameters<typeof syncLineParts>[0]);
    expect(syncDisplay(sync, 'open')).toEqual({ kind: 'open', ...parts });
  }
});

test('nothing open is up to date', () => {
  expect(syncDisplay(status(), 'open')).toEqual({ kind: 'ok' });
  expect(syncDisplay(status({ unpushed: 4 }), 'connecting')).toEqual({ kind: 'ok' });
  // Fehlende oder verbogene Felder zählen als »nichts offen«, statt die Kopfzeile zu sprengen.
  expect(syncDisplay({}, 'open')).toEqual({ kind: 'ok' });
  expect(syncDisplay({ conflicts: 'x', last_error: 'x', unpushed: '3' }, 'open')).toEqual({
    kind: 'ok',
  });
});
