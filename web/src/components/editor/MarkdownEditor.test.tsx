import { cleanup, createEvent, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ApiError } from '../../data/api-client.ts';
import { preload } from '../../test/chunks.ts';
import { box, png, setup } from '../../test/markdown-editor.tsx';

afterEach(cleanup);
// Die Vorschau rendert über den Markdown-Chunk.
preload(() => import('../../markdown/Markdown.tsx'));

test('typing changes the value', async () => {
  const spy = vi.fn();
  setup({ spy });
  await userEvent.type(box(), 'hi');
  expect(box().value).toBe('hi');
  expect(spy).toHaveBeenLastCalledWith('hi');
});

test('preview renders markdown', async () => {
  setup({ initial: '**fett**' });
  const toggle = screen.getByRole('button', { name: 'Vorschau' });
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  await userEvent.click(toggle);
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect((await screen.findByText('fett')).tagName).toBe('STRONG');
  expect(screen.queryByRole('textbox')).toBeNull();
});

test('a pasted image uploads and inserts a link at the cursor', async () => {
  const onImage = vi.fn(async () => 'shot.png');
  setup({ initial: 'ab', onImage });
  box().setSelectionRange(1, 1);
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  await waitFor(() => expect(box().value).toContain('![shot.png](attachments/shot.png)'));
  expect(box().value).toBe('a![shot.png](attachments/shot.png)b');
  expect(onImage).toHaveBeenCalledTimes(1);
  expect(box().selectionStart).toBe('a![shot.png](attachments/shot.png)'.length);
});

test('the selection is replaced by the link', async () => {
  setup({ initial: 'xAAy', onImage: async () => 'shot.png' });
  box().setSelectionRange(1, 3);
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  await waitFor(() => expect(box().value).toBe('x![shot.png](attachments/shot.png)y'));
});

test('several images go one after another, each on its own line', async () => {
  const order: string[] = [];
  const onImage = vi.fn(async (f: File) => {
    order.push(`start ${f.name}`);
    await Promise.resolve();
    order.push(`end ${f.name}`);
    return f.name;
  });
  setup({ onImage });
  const a = new File(['1'], 'a.png', { type: 'image/png' });
  const b = new File(['2'], 'b.png', { type: 'image/png' });
  fireEvent.paste(box(), { clipboardData: { files: [a, b] } });
  await waitFor(() => expect(box().value).toContain('b.png](attachments/b.png)'));
  expect(order).toEqual(['start a.png', 'end a.png', 'start b.png', 'end b.png']);
  expect(box().value).toBe('![a.png](attachments/a.png)\n![b.png](attachments/b.png)');
});

test('a dropped image uploads too and the drop does not bubble', async () => {
  const onImage = vi.fn(async () => 'shot.png');
  setup({ onImage });
  const outer = vi.fn();
  document.body.addEventListener('drop', outer);
  const ev = createEvent.drop(box(), { dataTransfer: { files: [png()] } });
  fireEvent(box(), ev);
  document.body.removeEventListener('drop', outer);
  expect(ev.defaultPrevented).toBe(true);
  await waitFor(() => expect(box().value).toBe('![shot.png](attachments/shot.png)'));
  expect(outer).not.toHaveBeenCalled();
});

test('a failed upload shows the error and keeps the text', async () => {
  const onImage = vi.fn(async (): Promise<string> => {
    throw new ApiError(400, 'bad', 'Zu groß', 'Nimm ein kleineres Bild.');
  });
  setup({ initial: 'text', onImage });
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  expect(await screen.findByText('Zu groß')).toBeTruthy();
  expect(screen.getByText('Nimm ein kleineres Bild.')).toBeTruthy();
  expect(box().value).toBe('text');
});

test('a thrown plain error is shown as well', async () => {
  setup({
    onImage: async (): Promise<string> => {
      throw new Error('kaputt');
    },
  });
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  expect(await screen.findByText('kaputt')).toBeTruthy();
});

test('without onImage images are not taken', () => {
  setup({});
  const paste = createEvent.paste(box(), { clipboardData: { files: [png()] } });
  fireEvent(box(), paste);
  expect(paste.defaultPrevented).toBe(false);
  const drop = createEvent.drop(box(), { dataTransfer: { files: [png()] } });
  fireEvent(box(), drop);
  expect(drop.defaultPrevented).toBe(false);
});

test('other files are ignored without preventDefault', () => {
  const onImage = vi.fn(async () => 'x.png');
  setup({ onImage });
  const txt = new File(['t'], 'a.txt', { type: 'text/plain' });
  const paste = createEvent.paste(box(), { clipboardData: { files: [txt] } });
  fireEvent(box(), paste);
  expect(paste.defaultPrevented).toBe(false);
  expect(onImage).not.toHaveBeenCalled();
});

test('local previews and the issue context reach the preview', async () => {
  setup({
    initial: '![s](attachments/shot.png)',
    local: new Map([['shot.png', 'blob:local-shot']]),
    issue: { id: 'bk-7f3k2', attachments: [] },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Vorschau' }));
  await waitFor(() =>
    expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:local-shot'),
  );
});

test('dragging files over the field allows the drop', () => {
  setup({ onImage: async () => 'x.png' });
  const over = createEvent.dragOver(box(), { dataTransfer: { types: ['Files'] } });
  fireEvent(box(), over);
  expect(over.defaultPrevented).toBe(true);
  const text = createEvent.dragOver(box(), { dataTransfer: { types: ['text/plain'] } });
  fireEvent(box(), text);
  expect(text.defaultPrevented).toBe(false);
});

test('a mixed drop hands the other files to onOtherFiles and does not bubble', async () => {
  const onImage = vi.fn(async () => 'shot.png');
  const onOtherFiles = vi.fn();
  setup({ onImage, onOtherFiles });
  const txt = new File(['t'], 'a.txt', { type: 'text/plain' });
  const outer = vi.fn();
  document.body.addEventListener('drop', outer);
  const ev = createEvent.drop(box(), { dataTransfer: { files: [png(), txt] } });
  fireEvent(box(), ev);
  document.body.removeEventListener('drop', outer);
  expect(ev.defaultPrevented).toBe(true);
  expect(outer).not.toHaveBeenCalled();
  expect(onOtherFiles).toHaveBeenCalledWith([txt]);
  await waitFor(() => expect(box().value).toBe('![shot.png](attachments/shot.png)'));
  expect(onImage).toHaveBeenCalledTimes(1);
});

test('without onOtherFiles a drop of plain files bubbles on', () => {
  setup({ onImage: async () => 'x.png' });
  const txt = new File(['t'], 'a.txt', { type: 'text/plain' });
  const drop = createEvent.drop(box(), { dataTransfer: { files: [txt] } });
  fireEvent(box(), drop);
  expect(drop.defaultPrevented).toBe(false);
});
