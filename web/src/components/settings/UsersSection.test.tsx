import type { UserJson } from '@backe/ui/api.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatDate } from '../../lib/format.ts';
import { call, region, registerSettingsHarness, view } from '../../test/settings-view.tsx';
import { testConfig, testPatch } from '../../test/state.ts';
import { m } from '../../views/settings.messages.ts';
import { m as w } from '../write/write.messages.ts';

registerSettingsHarness();

const spw: UserJson = {
  handle: 'spw',
  name: 'Spw',
  kind: 'human',
  admin: true,
  fingerprints: ['SHA256:spwkey1'],
};
const ana: UserJson = {
  handle: 'ana',
  name: 'Ana',
  kind: 'human',
  admin: false,
  fingerprints: ['SHA256:anakey1', 'SHA256:anakey2'],
  revoked: [{ fingerprint: 'SHA256:anaold0', revoked: '2026-11-01T10:00:00Z' }],
};
const bot: UserJson = {
  handle: 'bot',
  name: 'Bot',
  kind: 'agent',
  operator: 'ana',
  admin: false,
  fingerprints: ['SHA256:botkey1'],
};
const users = [spw, ana, bot];
const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGV4YW1wbGU ana@laptop';

const section = () => region(m.sectionUsers);
const list = () => within(section()).getByRole('list', { name: m.userList });
const item = (handle: string) => within(list()).getByRole('listitem', { name: handle });
const buttons = () =>
  within(section())
    .queryAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent);

test('users show kind, operator, fingerprints and revoked keys', () => {
  view({ canWrite: false, over: { users } });
  expect(
    within(list())
      .getAllByRole('listitem', { name: /^[a-z]+$/ })
      .map((li) => li.getAttribute('aria-label')),
  ).toEqual(['ana', 'bot', 'spw']);
  const a = item('ana');
  expect(within(a).getByText('ana').tagName).toBe('CODE');
  expect(a.textContent).toContain('Ana');
  expect(a.textContent).toContain(m.kindHuman);
  expect(a.textContent).not.toContain(m.adminMark);
  expect(within(a).getByText('SHA256:anakey1').tagName).toBe('CODE');
  expect(within(a).getByText('SHA256:anakey2')).toBeTruthy();
  // Widerrufen: durchgestrichen samt Datum.
  expect(within(a).getByText('SHA256:anaold0').closest('s')).not.toBeNull();
  expect(a.textContent).toContain(m.revokedAt(formatDate('2026-11-01T10:00:00Z')));
  const b = item('bot');
  expect(b.textContent).toContain(m.kindAgent);
  expect(b.textContent).toContain(m.operatedBy('ana'));
  expect(item('spw').textContent).toContain(m.adminMark);
  // Ohne Schreibrecht nur der Klappknopf.
  expect(buttons()).toEqual([m.sectionUsers]);
});

test('a user without an active key says so', () => {
  view({ over: { users: [{ ...bot, fingerprints: [] }, spw] } });
  expect(item('bot').textContent).toContain(m.noActiveKey);
});

test('a member sees only agent creation with himself as operator', async () => {
  const user = userEvent.setup();
  view({ me: 'ana', over: { users } });
  call.mockResolvedValue({ commit: 'c1' });
  // Als Mitglied: Widerrufen für sich und den eigenen Agent, kein Entfernen.
  expect(
    within(item('ana')).getByRole('button', { name: m.revokeKeyOf('SHA256:anakey1') }),
  ).toBeTruthy();
  expect(
    within(item('bot')).getByRole('button', { name: m.revokeKeyOf('SHA256:botkey1') }),
  ).toBeTruthy();
  expect(
    within(item('spw')).queryByRole('button', { name: m.revokeKeyOf('SHA256:spwkey1') }),
  ).toBeNull();
  for (const h of ['ana', 'bot', 'spw']) {
    expect(within(section()).queryByRole('button', { name: m.removeUserOf(h) })).toBeNull();
  }

  await user.click(within(section()).getByRole('button', { name: m.addUser }));
  const dialog = screen.getByRole('dialog', { name: m.addUserTitle });
  expect(within(dialog).queryByRole('radio')).toBeNull();
  expect(dialog.textContent).toContain(m.kindFixedAgent);
  // Der Operator steht fest da, ohne Auswahl.
  expect(within(dialog).queryByRole('combobox')).toBeNull();
  expect(within(dialog).getByText('ana').tagName).toBe('CODE');
  const add = within(dialog).getByRole('button', { name: m.addUser }) as HTMLButtonElement;
  await user.type(within(dialog).getByLabelText(m.userHandle), 'ana-bot');
  expect(add.disabled).toBe(true);
  const key = within(dialog).getByLabelText(m.publicKey);
  await user.type(key, 'ssh-rsa AAAA');
  expect(key.getAttribute('aria-invalid')).toBe('true');
  expect(add.disabled).toBe(true);
  await user.clear(key);
  await user.click(key);
  await user.paste(`${KEY}\n`);
  expect(add.disabled).toBe(false);
  await user.click(add);
  expect(call).toHaveBeenCalledWith('user_add', {
    handle: 'ana-bot',
    key: KEY,
    agent: true,
    operator: 'ana',
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('an admin adds a human with a pasted key', async () => {
  const user = userEvent.setup();
  view({ over: { users } });
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(section()).getByRole('button', { name: m.addUser }));
  const dialog = screen.getByRole('dialog', { name: m.addUserTitle });
  const human = within(dialog).getByRole('radio', { name: m.kindHuman }) as HTMLInputElement;
  expect(human.checked).toBe(true);
  expect(within(dialog).queryByLabelText(m.operator)).toBeNull();
  const handle = within(dialog).getByLabelText(m.userHandle);
  await user.type(handle, 'me');
  // `me` ist reserviert.
  expect(handle.getAttribute('aria-invalid')).toBe('true');
  expect(within(dialog).getByText(m.invalidHandle)).toBeTruthy();
  await user.clear(handle);
  await user.type(handle, 'eve');
  await user.type(within(dialog).getByLabelText(m.userName), 'Eve');
  await user.click(within(dialog).getByLabelText(m.publicKey));
  await user.paste(KEY);
  await user.click(within(dialog).getByRole('button', { name: m.addUser }));
  expect(call).toHaveBeenCalledWith('user_add', { handle: 'eve', key: KEY, name: 'Eve' });
});

test('an admin picks the operator of an agent among the humans', async () => {
  const user = userEvent.setup();
  view({ over: { users } });
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(section()).getByRole('button', { name: m.addUser }));
  const dialog = screen.getByRole('dialog', { name: m.addUserTitle });
  await user.click(within(dialog).getByRole('radio', { name: m.kindAgent }));
  const operator = within(dialog).getByLabelText(m.operator) as HTMLSelectElement;
  // Nur Menschen, vorbelegt mit mir.
  expect([...operator.options].map((o) => o.value)).toEqual(['ana', 'spw']);
  expect(operator.value).toBe('spw');
  await user.selectOptions(operator, 'ana');
  await user.type(within(dialog).getByLabelText(m.userHandle), 'helper');
  await user.click(within(dialog).getByLabelText(m.publicKey));
  await user.paste(KEY);
  // Enter im Key-Feld sendet ab, statt eine zweite Zeile anzufangen.
  await user.keyboard('{Enter}');
  expect(call).toHaveBeenCalledWith('user_add', {
    handle: 'helper',
    key: KEY,
    agent: true,
    operator: 'ana',
  });
});

test('creating an agent shows where the key lies', async () => {
  // `userEvent.setup` bringt eine Zwischenablage mit, die sich zurücklesen lässt.
  const user = userEvent.setup();
  view({ me: 'ana', over: { users } });
  const path = '/home/ana/.backe/keys/acme/claude-1';
  call.mockResolvedValue({ handle: 'claude-1', key_path: path, commit: 'c1' });
  const create = within(section()).getByRole('button', { name: m.createAgent });
  await user.click(create);
  const dialog = screen.getByRole('dialog', { name: m.createAgentTitle });
  expect(dialog.textContent).toContain(m.createAgentHint);
  await user.type(within(dialog).getByLabelText(m.userHandle), 'claude-1');
  await user.type(within(dialog).getByLabelText(m.userName), 'Claude{Enter}');
  expect(call).toHaveBeenCalledWith('user_create_agent', { handle: 'claude-1', name: 'Claude' });
  // Der Dialog bleibt offen und zeigt den Pfad des Keys.
  const done = await screen.findByText(m.keyPathCreated);
  expect(screen.getByRole('dialog').contains(done)).toBe(true);
  expect(screen.getByText(path)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: m.copyKeyPath }));
  expect(await navigator.clipboard.readText()).toBe(path);
  const close = screen.getByRole('button', { name: m.closeDialog });
  await user.click(close);
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(create));
});

test('revoking a key asks first', async () => {
  const user = userEvent.setup();
  view({ over: { users } });
  call.mockResolvedValue({ commit: 'c1' });
  const revoke = within(item('ana')).getByRole('button', {
    name: m.revokeKeyOf('SHA256:anakey2'),
  });
  await user.click(revoke);
  const dialog = screen.getByRole('dialog', { name: m.revokeKeyTitle('ana') });
  expect(within(dialog).getByText('SHA256:anakey2').tagName).toBe('CODE');
  expect(dialog.textContent).toContain(m.revokeFinal);
  // Abbrechen sendet nichts und gibt den Fokus zurück.
  await user.click(within(dialog).getByRole('button', { name: w.cancel }));
  expect(call).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(revoke));
  await user.click(revoke);
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: m.revokeKey }));
  expect(call).toHaveBeenCalledWith('user_revoke_key', {
    handle: 'ana',
    fingerprint: 'SHA256:anakey2',
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a revoke dialog closes when the key is gone by patch', async () => {
  const user = userEvent.setup();
  const { store } = view({ over: { users } });
  await user.click(
    within(item('ana')).getByRole('button', { name: m.revokeKeyOf('SHA256:anakey2') }),
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
  act(() => {
    store.applyPatch(
      testPatch(2, { upsert: { users: [{ ...ana, fingerprints: ['SHA256:anakey1'] }] } }),
    );
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('removing a user asks first and is hidden where policy refuses', async () => {
  const user = userEvent.setup();
  view({ over: { users } });
  call.mockResolvedValue({ commit: 'c1' });
  // `spw` ist Admin und ich, `ana` Operator von `bot`.
  expect(within(item('spw')).queryByRole('button', { name: m.removeUserOf('spw') })).toBeNull();
  expect(within(item('ana')).queryByRole('button', { name: m.removeUserOf('ana') })).toBeNull();
  await user.click(within(item('bot')).getByRole('button', { name: m.removeUserOf('bot') }));
  const dialog = screen.getByRole('dialog', { name: m.removeUserTitle('bot') });
  expect(dialog.textContent).toContain(m.removeUserHint);
  await user.click(within(dialog).getByRole('button', { name: m.removeUser }));
  expect(call).toHaveBeenCalledWith('user_rm', { handle: 'bot' });
  expect(screen.queryByRole('dialog')).toBeNull();
  // Die Zeile geht mit dem User; der Fokus geht an »Hinzufügen«.
  await waitFor(() =>
    expect(document.activeElement).toBe(within(section()).getByRole('button', { name: m.addUser })),
  );
});

test('an agent may only revoke its own keys', () => {
  view({ me: 'bot', over: { users } });
  expect(buttons()).toEqual([m.sectionUsers, m.revokeKeyOf('SHA256:botkey1')]);
});

test('an agent listed in admins carries no admin mark', () => {
  // Der Server setzt `admin` nach `admins`; Admin ist aber nur ein Mensch (BK §2.13).
  view({
    over: {
      users: [spw, ana, { ...bot, admin: true }],
      config: testConfig({ admins: ['spw', 'bot'] }),
    },
  });
  expect(item('bot').textContent).not.toContain(m.adminMark);
  expect(item('spw').textContent).toContain(m.adminMark);
});

test('losing admin rights while adding turns the new user into my agent', async () => {
  const user = userEvent.setup();
  const { store } = view({ over: { users } });
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(section()).getByRole('button', { name: m.addUser }));
  const dialog = screen.getByRole('dialog', { name: m.addUserTitle });
  expect(within(dialog).getByRole('radio', { name: m.kindHuman })).toBeTruthy();
  await user.type(within(dialog).getByLabelText(m.userHandle), 'eve');
  await user.click(within(dialog).getByLabelText(m.publicKey));
  await user.paste(KEY);
  act(() => {
    store.applyPatch(testPatch(2, { upsert: { config: testConfig({ admins: ['ana'] }) } }));
  });
  // Ohne Admin-Rechte kein Mensch mehr: fest ein Agent mit mir als Operator.
  expect(within(dialog).queryByRole('radio')).toBeNull();
  expect(within(dialog).getByText('spw').tagName).toBe('CODE');
  await user.click(within(dialog).getByRole('button', { name: m.addUser }));
  expect(call).toHaveBeenCalledWith('user_add', {
    handle: 'eve',
    key: KEY,
    agent: true,
    operator: 'spw',
  });
});

test('a remove dialog closes when the user is gone by patch', async () => {
  const user = userEvent.setup();
  const { store } = view({ over: { users } });
  await user.click(within(item('bot')).getByRole('button', { name: m.removeUserOf('bot') }));
  expect(screen.getByRole('dialog', { name: m.removeUserTitle('bot') })).toBeTruthy();
  act(() => {
    store.applyPatch(testPatch(2, { remove: { users: ['bot'] } }));
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(list()).queryByRole('listitem', { name: 'bot' })).toBeNull();
});
