import { act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatBytes, formatDate } from '../../lib/format.ts';
import {
  call,
  described,
  region,
  registerSettingsHarness,
  view,
} from '../../test/settings-view.tsx';
import { testConfig } from '../../test/state.ts';
import { failure } from '../../test/writes.ts';
import { m } from '../../views/settings.messages.ts';

registerSettingsHarness();

const CONFLICT = '20261120T100000Z-abc123';

const syncStatus = {
  remote: 'origin',
  mode: 'auto',
  unpushed: 2,
  last_attempt: '2026-11-20T10:00:00Z',
  last_success: '2026-11-19T09:30:00Z',
  last_error: { code: 'push_rejected', message: 'Push abgelehnt', at: '2026-11-20T10:00:00Z' },
  running: false,
  conflicts: [
    {
      id: CONFLICT,
      created: '2026-11-20T10:00:00Z',
      subject: 'issue move bk-t0001 done',
      reason: { code: 'precondition', message: 'Der State hat sich inzwischen geändert' },
    },
  ],
};

test('the config shows read only with declared properties', () => {
  view({
    over: {
      config: testConfig({
        admins: ['spw', 'anna'],
        id_prefix: 'ac',
        workflow: { strict: true },
        sync: { mode: 'manual', remote: 'up', branch: 'trunk', pull_interval: 30 },
        verify: 'warn',
        attachments: { max_bytes: 1048576, lfs: true },
        props: {
          prio: { type: 'enum', description: 'Wie dringend', values: ['low', 'high'] },
          size: { type: 'integer', description: 'Punkte' },
        },
      }),
    },
  });
  const section = region(m.sectionBacklog);
  expect(described(section, m.name)).toBe('acme');
  expect(described(section, m.idPrefix)).toBe('ac');
  expect(described(section, m.admins)).toBe('spw, anna');
  expect(described(section, m.strictWorkflow)).toBe(m.yes);
  expect(described(section, m.sync)).toBe(m.syncSettings('manual', 'up', 'trunk', m.pullEvery(30)));
  expect(described(section, m.verify)).toBe('warn');
  expect(described(section, m.attachments)).toBe(m.maxBytes(formatBytes(1048576)));
  expect(described(section, m.lfs)).toBe(m.yes);
  expect(described(section, m.propsStrict)).toBe(m.no);
  // Datei und Befehl stehen als Code im Hinweis.
  const file = within(section).getByText('.backe/backlog.jsonc');
  expect(file.tagName).toBe('CODE');
  expect(within(section).getByText('backe commit').tagName).toBe('CODE');
  // Der Satz kommt in Teilen aus dem Katalog; kein Text wird nach den Literalen durchsucht.
  expect(file.parentElement?.textContent).toBe(
    `${m.configReadOnlyBefore}.backe/backlog.jsonc${m.configReadOnlyBetween}backe commit${m.configReadOnlyAfter}`,
  );

  const table = within(section).getByRole('table', { name: m.properties });
  const rows = within(table)
    .getAllByRole('row')
    .slice(1)
    .map((r) =>
      within(r)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    );
  expect(rows).toEqual([
    ['prio', 'enum: low, high', 'Wie dringend'],
    ['size', 'integer', 'Punkte'],
  ]);
  // Lesend: nichts zum Bearbeiten.
  expect(within(section).queryByRole('textbox')).toBeNull();
});

test('defaults read as such: unlimited attachments, no properties, no pull timer', () => {
  view({
    over: {
      config: testConfig({
        attachments: { max_bytes: null, lfs: false },
        sync: { pull_interval: 0 },
      }),
    },
  });
  const section = region(m.sectionBacklog);
  expect(described(section, m.attachments)).toBe(m.unlimited);
  // `pull_interval: 0`: kein Takt, ein Read stößt jedes Mal eine Runde an (backe.md §2.16.3).
  expect(described(section, m.sync)).toBe(
    m.syncSettings('auto', 'origin', 'main', m.pullOnEveryRead),
  );
  expect(described(section, m.strictWorkflow)).toBe(m.no);
  expect(within(section).getByText(m.noProperties)).toBeTruthy();
  expect(within(section).queryByRole('table')).toBeNull();
});

test('sync status lists conflicts with the resolve hint', () => {
  view({ canWrite: false, over: { sync: syncStatus } });
  const section = region(m.sectionBacklog);
  expect(described(section, m.remote)).toBe('origin');
  expect(described(section, m.mode)).toBe('auto');
  expect(described(section, m.unpushed)).toBe('2');
  expect(described(section, m.lastAttempt)).toBe(formatDate('2026-11-20T10:00:00Z'));
  expect(described(section, m.lastSuccess)).toBe(formatDate('2026-11-19T09:30:00Z'));
  expect(described(section, m.lastError)).toBe('Push abgelehnt');
  expect(described(section, m.running)).toBe(m.no);
  // Config und Sync-Status teilen dieselbe Spaltenvorlage, damit die Werte untereinander stehen.
  const lists = [...section.querySelectorAll('dl')];
  expect(lists).toHaveLength(2);
  expect(lists[0]?.className).toBe(lists[1]?.className);
  expect(lists[0]?.className).not.toContain('max-content');

  const conflicts = within(section).getByRole('list', { name: m.conflicts });
  const item = within(conflicts).getByRole('listitem');
  expect(within(item).getByText(CONFLICT).tagName).toBe('CODE');
  expect(item.textContent).toContain('issue move bk-t0001 done');
  expect(item.textContent).toContain('Der State hat sich inzwischen geändert');
  expect(item.textContent).toContain(formatDate('2026-11-20T10:00:00Z'));
  expect(within(section).getByText('backe sync resolve').tagName).toBe('CODE');
  // Ohne Schreibrecht kein Knopf.
  expect(within(section).queryByRole('button', { name: m.syncNow })).toBeNull();
});

test('a sparse sync status reads without gaps', () => {
  // Das JSON kommt ungeprüft: Was fehlt oder nicht passt, steht als »nie«, »keiner« oder fehlt.
  view({ over: { sync: { remote: null, mode: 'auto', unpushed: 'x', running: true } } });
  const section = region(m.sectionBacklog);
  expect(described(section, m.remote)).toBe(m.noRemote);
  expect(described(section, m.unpushed)).toBe('0');
  expect(described(section, m.lastAttempt)).toBe(m.never);
  expect(described(section, m.lastSuccess)).toBe(m.never);
  expect(described(section, m.lastError)).toBe(m.none);
  expect(described(section, m.running)).toBe(m.yes);
  expect(within(section).queryByRole('list', { name: m.conflicts })).toBeNull();
  expect(within(section).queryByText('backe sync resolve')).toBeNull();
});

test('sync now calls the tool and shows the result', async () => {
  const user = userEvent.setup();
  // React meldet doppelte Keys auf der Konsole.
  const logged = vi.spyOn(console, 'error');
  const { store } = view({ over: { sync: { ...syncStatus, conflicts: [] } } });
  const section = region(m.sectionBacklog);
  let answer: (v: unknown) => void = () => {};
  call.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const button = within(section).getByRole('button', { name: m.syncNow }) as HTMLButtonElement;
  await user.click(button);
  expect(call).toHaveBeenCalledWith('sync_now', {});
  expect(button.disabled).toBe(true);
  await act(async () =>
    answer({
      fetched: 2,
      replayed: 1,
      conflicts: [],
      pushed: '0123456789abcdef0123456789abcdef01234567',
      rounds: 1,
      // Zweimal derselbe Hinweis: beide Zeilen stehen, ohne doppelten Key.
      notices: [{ message: 'LFS-Objekte nachgeladen' }, { message: 'LFS-Objekte nachgeladen' }],
    }),
  );
  expect(button.disabled).toBe(false);
  const status = within(section).getByRole('status');
  expect(status.textContent).toContain(m.syncDone(2, 1, '0123456'));
  expect(
    within(status)
      .getAllByRole('listitem')
      .map((li) => li.textContent),
  ).toEqual(['LFS-Objekte nachgeladen', 'LFS-Objekte nachgeladen']);
  expect(logged).not.toHaveBeenCalled();

  // Ohne Push und ohne Remote.
  call.mockResolvedValueOnce({ fetched: 0, replayed: 0, conflicts: [], pushed: null, rounds: 1 });
  await user.click(button);
  expect(within(section).getByRole('status').textContent).toBe(m.syncDone(0, 0, null));
  call.mockResolvedValueOnce({
    fetched: 0,
    replayed: 0,
    conflicts: [],
    pushed: null,
    rounds: 0,
    skipped: 'no_remote',
  });
  await user.click(button);
  expect(within(section).getByRole('status').textContent).toBe(m.syncSkipped);

  // Ein Fehler ersetzt das Ergebnis.
  call.mockRejectedValueOnce(failure());
  await user.click(button);
  expect(within(section).getByRole('alert').textContent).toContain('Issue ist gesperrt');
  expect(within(section).getByRole('status').textContent).toBe('');
  // Der Status selbst kommt über den Store, nicht aus der Antwort.
  expect(store.sync.value).not.toBeNull();
  logged.mockRestore();
});

test('without a working copy there is no sync block', () => {
  view({ over: { sync: null } });
  const section = region(m.sectionBacklog);
  expect(within(section).getByText(m.noWorkingCopy)).toBeTruthy();
  expect(within(section).queryByRole('button', { name: m.syncNow })).toBeNull();
  expect(described(section, m.remote)).toBeUndefined();
});
