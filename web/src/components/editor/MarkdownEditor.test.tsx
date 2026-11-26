import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { Router, RouterContext } from '../../app/router.ts';
import { ApiError } from '../../data/api-client.ts';
import { Store } from '../../data/store.ts';
import { StoreContext } from '../../data/store-context.tsx';
import { testState } from '../../test/state.ts';
import { MarkdownEditor, type MarkdownEditorProps } from './MarkdownEditor.tsx';

afterEach(cleanup);

type HarnessProps = Partial<MarkdownEditorProps> & {
  initial?: string;
  spy?: (v: string) => void;
};

function Harness(props: HarnessProps) {
  const [value, setValue] = useState(props.initial ?? '');
  const { initial: _i, spy, ...rest } = props;
  return (
    <MarkdownEditor
      label="Body"
      backlog="acme"
      value={value}
      onChange={(v) => {
        spy?.(v);
        setValue(v);
      }}
      {...rest}
    />
  );
}

function setup(props: HarnessProps = {}) {
  window.history.replaceState(null, '', '/b/acme/issue/bk-t0001');
  const router = new Router(window);
  const store = new Store();
  store.load(testState([]));
  return render(
    <RouterContext.Provider value={router}>
      <StoreContext.Provider value={store}>
        <Harness {...props} />
      </StoreContext.Provider>
    </RouterContext.Provider>,
  );
}

const png = () => new File(['x'], 'Shot.PNG', { type: 'image/png' });
const box = () => screen.getByRole('textbox', { name: 'Body' }) as HTMLTextAreaElement;

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

test('a status line shows during the upload', async () => {
  let done: (n: string) => void = () => {};
  setup({ onImage: () => new Promise<string>((r) => (done = r)) });
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  expect((await screen.findByRole('status')).textContent).not.toBe('');
  done('shot.png');
  await waitFor(() => expect(screen.queryByRole('status')?.textContent ?? '').toBe(''));
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
