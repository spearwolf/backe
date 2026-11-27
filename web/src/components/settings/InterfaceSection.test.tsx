import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { m as app } from '../../app/app.messages.ts';
import { THEME_KEY } from '../../app/theme.ts';
import {
  BOARD_GROUP_KEY,
  EXTERNAL_IMAGES_KEY,
  LANG_KEY,
  NOTIFICATIONS_KEY,
} from '../../app/ui-prefs.ts';
import { installNotifications } from '../../test/notifications.ts';
import { region, registerSettingsHarness, view } from '../../test/settings-view.tsx';
import { m as board } from '../../views/board.messages.ts';
import { m } from '../../views/settings.messages.ts';

registerSettingsHarness();

let fake: ReturnType<typeof installNotifications> | undefined;
afterEach(() => {
  fake?.uninstall();
  fake = undefined;
});

const notesBox = () =>
  within(region(m.sectionInterface)).getByRole('checkbox', {
    name: m.notifications,
  }) as HTMLInputElement;

const description = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent)
    .join(' ');

test('theme, language, images and board grouping write their settings', async () => {
  const user = userEvent.setup();
  const { prefs } = view({ serverLang: 'en' });
  const section = region(m.sectionInterface);

  const themes = within(section).getByRole('group', { name: app.theme });
  const radios = within(themes).getAllByRole('radio') as HTMLInputElement[];
  expect(radios.map((r) => r.labels?.[0]?.textContent)).toEqual([
    app.themeLight,
    app.themeDark,
    app.themeSystem,
  ]);
  expect(radios.map((r) => r.checked)).toEqual([false, false, true]);
  await user.click(within(themes).getByRole('radio', { name: app.themeDark }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  expect(radios.map((r) => r.checked)).toEqual([false, true, false]);

  const images = within(section).getByRole('checkbox', {
    name: m.externalImages,
  }) as HTMLInputElement;
  expect(images.checked).toBe(true);
  expect(description(images)).toBe(m.externalImagesHint);
  await user.click(images);
  expect(prefs.externalImages.value).toBe(false);
  expect(localStorage.getItem(EXTERNAL_IMAGES_KEY)).toBe('off');
  expect(images.checked).toBe(false);

  const group = within(section).getByRole('combobox', { name: m.boardGroup }) as HTMLSelectElement;
  expect([...group.options].map((o) => o.textContent)).toEqual([
    board.groupSprint,
    board.groupProject,
    board.groupRepo,
    board.groupNone,
  ]);
  expect(group.value).toBe('sprint');
  expect(description(group)).toBe(m.boardGroupHint);
  await user.selectOptions(group, 'repo');
  expect(prefs.boardGroup.value).toBe('repo');
  expect(localStorage.getItem(BOARD_GROUP_KEY)).toBe('repo');

  // Zuletzt: Der Sprachwechsel baut die Ansicht neu auf.
  const lang = within(section).getByRole('combobox', { name: m.language }) as HTMLSelectElement;
  expect([...lang.options].map((o) => [o.value, o.textContent])).toEqual([
    ['server', m.langServer('English')],
    ['en', 'English'],
    ['de', 'Deutsch'],
  ]);
  expect(lang.value).toBe('server');
  await user.selectOptions(lang, 'de');
  expect(prefs.lang()).toBe('de');
  expect(localStorage.getItem(LANG_KEY)).toBe('de');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Einstellungen');
});

test('the language select keeps the focus after a switch', async () => {
  const user = userEvent.setup();
  // Die Route zeigt auf den Abschnitt: Nach dem Neumounten gewinnt trotzdem die Sprachwahl.
  view({ section: 'interface', serverLang: 'en' });
  const before = screen.getByRole('combobox', { name: m.language }) as HTMLSelectElement;
  await user.selectOptions(before, 'de');
  const after = screen.getByRole('combobox', { name: m.language }) as HTMLSelectElement;
  expect(after).not.toBe(before);
  expect(after.value).toBe('de');
  expect(document.activeElement).toBe(after);

  // Zurück zur Sprache des Servers (Englisch): wieder ein Neumounten, wieder dort der Fokus.
  await user.selectOptions(after, 'server');
  const back = screen.getByRole('combobox', { name: m.language }) as HTMLSelectElement;
  expect(back).not.toBe(after);
  expect(back.value).toBe('server');
  expect(document.activeElement).toBe(back);
});

test('switching notifications on asks the browser first', async () => {
  const user = userEvent.setup();
  fake = installNotifications({ permission: 'default', answer: 'granted' });
  const { prefs } = view();
  const box = notesBox();
  expect(box.checked).toBe(false);
  await user.click(box);
  expect(fake.requests).toBe(1);
  expect(prefs.notifications.value).toBe(true);
  expect(box.checked).toBe(true);
  expect(description(box)).toBe(m.notificationsHint);
});

test('a refused permission keeps notifications off', async () => {
  const user = userEvent.setup();
  fake = installNotifications({ permission: 'default', answer: 'denied' });
  const { prefs } = view();
  const box = notesBox();
  await user.click(box);
  expect(prefs.notifications.value).toBe(false);
  expect(box.checked).toBe(false);
  expect(box.disabled).toBe(true);
  expect(description(box)).toContain(m.notificationsDenied);
});

test('without the api the switch is disabled', () => {
  fake = installNotifications({ permission: 'missing' });
  view();
  const box = notesBox();
  expect(box.disabled).toBe(true);
  expect(description(box)).toContain(m.notificationsUnsupported);
});

test('switching off needs no request', async () => {
  const user = userEvent.setup();
  localStorage.setItem(NOTIFICATIONS_KEY, 'on');
  fake = installNotifications({ permission: 'granted' });
  const { prefs } = view();
  const box = notesBox();
  expect(box.checked).toBe(true);
  await user.click(box);
  expect(prefs.notifications.value).toBe(false);
  expect(box.checked).toBe(false);
  expect(fake.requests).toBe(0);
  expect(localStorage.getItem(NOTIFICATIONS_KEY)).toBe('off');
});

test('a stored switch with an open question asks on the click', async () => {
  const user = userEvent.setup();
  localStorage.setItem(NOTIFICATIONS_KEY, 'on');
  fake = installNotifications({ permission: 'default', answer: 'granted' });
  const { prefs } = view();
  const box = notesBox();
  expect(box.checked).toBe(false);
  await user.click(box);
  expect(fake.requests).toBe(1);
  expect(prefs.notifications.value).toBe(true);
  expect(box.checked).toBe(true);
});

test('the permission is re-read when the page becomes visible again', () => {
  localStorage.setItem(NOTIFICATIONS_KEY, 'on');
  fake = installNotifications({ permission: 'granted' });
  view();
  const box = notesBox();
  expect(box.checked).toBe(true);
  expect(box.disabled).toBe(false);
  (globalThis.Notification as { permission: string }).permission = 'denied';
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(box.checked).toBe(false);
  expect(box.disabled).toBe(true);
  expect(description(box)).toContain(m.notificationsDenied);
});

test('the permissions api change event refreshes and is released on unmount', async () => {
  const listeners = new Set<() => void>();
  const status = {
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  const query = vi.fn(async () => status);
  Object.defineProperty(navigator, 'permissions', { value: { query }, configurable: true });
  try {
    fake = installNotifications({ permission: 'granted' });
    const { unmount } = view();
    await waitFor(() => expect(listeners.size).toBe(1));
    expect(query).toHaveBeenCalledWith({ name: 'notifications' });
    (globalThis.Notification as { permission: string }).permission = 'denied';
    act(() => {
      for (const fn of listeners) fn();
    });
    expect(notesBox().disabled).toBe(true);
    unmount();
    expect(listeners.size).toBe(0);
  } finally {
    delete (navigator as { permissions?: unknown }).permissions;
  }
});

test('the switch is busy while the browser is asked', async () => {
  const user = userEvent.setup();
  fake = installNotifications({ permission: 'default', answer: 'granted' });
  const Note = globalThis.Notification as unknown as {
    requestPermission: () => Promise<NotificationPermission>;
  };
  const real = Note.requestPermission;
  let asked = 0;
  let release: () => void = () => {};
  Note.requestPermission = () => {
    asked += 1;
    return new Promise((resolve) => {
      release = () => resolve(real());
    });
  };
  const { prefs } = view();
  const box = notesBox();
  await user.click(box);
  // Nur `aria-disabled`: Ein echtes `disabled` nähme dem Schalter den Tastaturfokus.
  expect(box.disabled).toBe(false);
  expect(box.getAttribute('aria-disabled')).toBe('true');
  expect(box.getAttribute('aria-busy')).toBe('true');
  expect(document.activeElement).toBe(box);
  await user.click(box);
  await user.keyboard(' ');
  expect(asked).toBe(1);
  expect(box.checked).toBe(false);
  expect(document.activeElement).toBe(box);
  release();
  await waitFor(() => expect(prefs.notifications.value).toBe(true));
  expect(fake.requests).toBe(1);
  expect(box.hasAttribute('aria-disabled')).toBe(false);
  expect(box.checked).toBe(true);
  expect(document.activeElement).toBe(box);
});

test('a stored switch without permission shows off', () => {
  localStorage.setItem(NOTIFICATIONS_KEY, 'on');
  fake = installNotifications({ permission: 'denied' });
  view();
  expect(notesBox().checked).toBe(false);
});
