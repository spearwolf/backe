import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { box, png, setup } from '../../test/markdown-editor.tsx';

afterEach(cleanup);

test('a status line shows during the upload', async () => {
  let done: (n: string) => void = () => {};
  setup({ onImage: () => new Promise<string>((r) => (done = r)) });
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  expect((await screen.findByRole('status')).textContent).not.toBe('');
  done('shot.png');
  await waitFor(() => expect(screen.queryByRole('status')?.textContent ?? '').toBe(''));
});

test('a second paste during a running upload is queued, not lost', async () => {
  const gates: Array<(n: string) => void> = [];
  const onImage = vi.fn((_f: File) => new Promise<string>((r) => gates.push(r)));
  setup({ onImage });
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  await waitFor(() => expect(gates).toHaveLength(1));
  expect(onImage).toHaveBeenCalledTimes(1);
  gates[0]?.('one.png');
  await waitFor(() => expect(gates).toHaveLength(2));
  // Die Statuszeile bleibt, bis die Warteschlange leer ist.
  expect(screen.getByRole('status').textContent).toBe('Bild wird hochgeladen…');
  gates[1]?.('two.png');
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(''));
  expect(box().value).toBe('![one.png](attachments/one.png)\n![two.png](attachments/two.png)');
});

test('the status line names the upload while it runs', async () => {
  let done: (n: string) => void = () => {};
  setup({ onImage: () => new Promise<string>((r) => (done = r)) });
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  expect((await screen.findByRole('status')).textContent).toBe('Bild wird hochgeladen…');
  done('shot.png');
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(''));
});

test('the caret stays where the user put it meanwhile', async () => {
  let done: (n: string) => void = () => {};
  const started = vi.fn();
  setup({
    initial: 'abcdef',
    onImage: () =>
      new Promise<string>((r) => {
        started();
        done = r;
      }),
  });
  box().setSelectionRange(1, 1);
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  await waitFor(() => expect(started).toHaveBeenCalled());
  box().setSelectionRange(5, 5);
  done('s.png');
  await waitFor(() => expect(box().value).toBe('a![s.png](attachments/s.png)bcdef'));
  // Die Stelle des Nutzers (5) rückt um die Länge des eingefügten Links nach.
  const shifted = 5 + '![s.png](attachments/s.png)'.length;
  expect(box().selectionStart).toBe(shifted);
  expect(box().selectionEnd).toBe(shifted);
});

test('a pending caret does not jump after a detour through the preview', async () => {
  let done: (n: string) => void = () => {};
  const started = vi.fn();
  setup({
    initial: 'ab',
    onImage: () =>
      new Promise<string>((r) => {
        started();
        done = r;
      }),
  });
  box().setSelectionRange(1, 1);
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  await waitFor(() => expect(started).toHaveBeenCalled());
  await userEvent.click(screen.getByRole('button', { name: 'Vorschau' }));
  done('s.png');
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(''));
  await userEvent.click(screen.getByRole('button', { name: 'Text' }));
  box().setSelectionRange(0, 0);
  await userEvent.type(box(), 'x', { initialSelectionStart: 0, initialSelectionEnd: 0 });
  expect(box().selectionStart).toBe(1);
});

test('nothing is inserted after unmount mid-batch', async () => {
  const gates: Array<(n: string) => void> = [];
  const spy = vi.fn();
  const view = setup({ spy, onImage: () => new Promise<string>((r) => gates.push(r)) });
  const a = new File(['1'], 'a.png', { type: 'image/png' });
  const b = new File(['2'], 'b.png', { type: 'image/png' });
  fireEvent.paste(box(), { clipboardData: { files: [a, b] } });
  await waitFor(() => expect(gates).toHaveLength(1));
  gates[0]?.('a.png');
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(gates).toHaveLength(2));
  view.unmount();
  gates[1]?.('b.png');
  await Promise.resolve();
  await Promise.resolve();
  expect(spy).toHaveBeenCalledTimes(1);
});

test('queued batches do not upload after unmount', async () => {
  const gates: Array<(n: string) => void> = [];
  const onImage = vi.fn((_f: File) => new Promise<string>((r) => gates.push(r)));
  const view = setup({ onImage });
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  await waitFor(() => expect(gates).toHaveLength(1));
  view.unmount();
  gates[0]?.('a.png');
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(onImage).toHaveBeenCalledTimes(1);
});

test('a queued batch keeps the error of the one before; a new paste when idle clears it', async () => {
  const gates: Array<{ ok: (n: string) => void; fail: (e: Error) => void }> = [];
  const onImage = vi.fn(
    (_f: File) =>
      new Promise<string>((ok, fail) => {
        gates.push({ ok, fail });
      }),
  );
  setup({ onImage });
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  await waitFor(() => expect(gates).toHaveLength(1));
  gates[0]?.fail(new Error('erster kaputt'));
  await waitFor(() => expect(gates).toHaveLength(2));
  // Der Link des ersten Bildes fehlt: Das muss stehen bleiben, auch während das zweite läuft.
  expect(screen.getByText('erster kaputt')).toBeTruthy();
  gates[1]?.ok('two.png');
  await waitFor(() => expect(box().value).toBe('![two.png](attachments/two.png)'));
  expect(screen.getByText('erster kaputt')).toBeTruthy();
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  await waitFor(() => expect(gates).toHaveLength(3));
  expect(screen.queryByText('erster kaputt')).toBeNull();
  gates[2]?.ok('three.png');
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(''));
});

test('the upload state is reported to the parent', async () => {
  const gates: Array<(n: string) => void> = [];
  const onBusyChange = vi.fn();
  setup({ onImage: () => new Promise<string>((r) => gates.push(r)), onBusyChange });
  expect(onBusyChange.mock.calls).toEqual([[false]]);
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  await waitFor(() => expect(gates).toHaveLength(1));
  gates[0]?.('one.png');
  await waitFor(() => expect(gates).toHaveLength(2));
  // Ein Stapel wartet noch: Der Zustand bleibt »beschäftigt«.
  expect(onBusyChange.mock.calls).toEqual([[false], [true]]);
  gates[1]?.('two.png');
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  expect(box().value).toBe('![one.png](attachments/one.png)\n![two.png](attachments/two.png)');
});
