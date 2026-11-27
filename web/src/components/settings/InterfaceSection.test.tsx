import { screen, within } from '@testing-library/react';
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

test('a stored switch without permission shows off', () => {
  localStorage.setItem(NOTIFICATIONS_KEY, 'on');
  fake = installNotifications({ permission: 'denied' });
  view();
  expect(notesBox().checked).toBe(false);
});
