import { afterEach, expect, test, vi } from 'vitest';
import { installNotifications } from '../test/notifications.ts';
import { notePermission, requestNotePermission, showBrowserNote } from './browser-notes.ts';

let fake: ReturnType<typeof installNotifications> | undefined;

afterEach(() => {
  fake?.uninstall();
  fake = undefined;
  vi.restoreAllMocks();
});

test('permission and request follow the browser', async () => {
  fake = installNotifications({ permission: 'missing' });
  expect(notePermission()).toBe('unsupported');
  expect(await requestNotePermission()).toBe('unsupported');
  fake.uninstall();

  fake = installNotifications({ permission: 'default', answer: 'granted' });
  expect(notePermission()).toBe('default');
  expect(await requestNotePermission()).toBe('granted');
  expect(fake.requests).toBe(1);
  expect(notePermission()).toBe('granted');
  fake.uninstall();

  fake = installNotifications({ permission: 'denied' });
  expect(await requestNotePermission()).toBe('denied');
  expect(fake.requests).toBe(0);
});

test('a note shows only with permission and clicks through', () => {
  const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
  const onClick = vi.fn();
  fake = installNotifications({ permission: 'granted' });
  showBrowserNote({ title: 'T', body: 'B', tag: 'x', onClick });
  expect(fake.shown).toHaveLength(1);
  expect(fake.shown[0]).toMatchObject({ title: 'T', body: 'B', tag: 'x' });
  fake.shown[0]?.click();
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(focus).toHaveBeenCalledTimes(1);
  expect(fake.shown[0]?.closed).toBe(true);
  fake.uninstall();

  fake = installNotifications({ permission: 'denied' });
  showBrowserNote({ title: 'T', body: 'B', tag: 'x', onClick });
  expect(fake.shown).toEqual([]);
  fake.uninstall();

  fake = installNotifications({ permission: 'missing' });
  expect(() => showBrowserNote({ title: 'T', body: 'B', tag: 'x', onClick })).not.toThrow();
});
