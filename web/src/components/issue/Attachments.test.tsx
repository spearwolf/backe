import { setLocale } from '@backe/i18n/locale.ts';
import type { AttachmentListJson } from '@backe/ui/api.ts';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { attachmentUrl } from '../../data/issue-api.ts';
import { m } from '../../views/issue.messages.ts';
import { Attachments } from './Attachments.tsx';

vi.mock('../../markdown/index.tsx', () => ({
  Markdown: ({ source }: { source: string }) => <div data-testid="markdown">{source}</div>,
}));

type Reply = { type: string; body: string };
let replies: Record<string, Reply>;
const requested: string[] = [];

beforeEach(() => {
  replies = {};
  requested.length = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    requested.push(url);
    const reply = replies[url];
    if (reply === undefined) return new Response('nope', { status: 404 });
    return new Response(reply.body, { headers: { 'content-type': reply.type } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setLocale('de');
});

const url = (name: string) => attachmentUrl('acme', 'bck-aaaaa', name);

function show(list: AttachmentListJson, root = '/wc') {
  return render(
    <Attachments
      attachments={list}
      backlog="acme"
      id="bck-aaaaa"
      root={root}
      issue={{ id: 'bck-aaaaa', attachments: [] }}
    />,
  );
}

test('images preview and enlarge', async () => {
  const user = userEvent.setup();
  show([{ name: 'shot.png', file: 'shot.png', size: 2048 }]);
  const img = screen.getByRole('img', { name: 'shot.png' });
  expect(img.getAttribute('src')).toBe(url('shot.png'));
  expect(img.getAttribute('loading')).toBe('lazy');
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(screen.getByRole('button', { name: m.enlarge('shot.png') }));
  const dialog = screen.getByRole('dialog');
  expect(dialog.querySelector('img')?.getAttribute('src')).toBe(url('shot.png'));
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('svg stays an img', () => {
  const { container } = show([{ name: 'logo.svg', file: 'logo.svg', size: 100 }]);
  expect(screen.getByRole('img', { name: 'logo.svg' }).tagName).toBe('IMG');
  expect(container.querySelector('object, iframe, embed')).toBeNull();
});

test('text previews with highlighting', async () => {
  replies[url('data.json')] = { type: 'text/plain; charset=utf-8', body: '{"a": 1}' };
  const { container } = show([{ name: 'data.json', file: 'data.json', size: 8 }]);
  await waitFor(() => expect(container.querySelector('code.language-json')).not.toBeNull());
  expect(container.querySelector('details')?.hasAttribute('open')).toBe(true);
  expect(container.querySelector('code')?.textContent).toBe('{"a": 1}');
  const link = screen.getByRole('link', { name: new RegExp(m.download) });
  expect(link.hasAttribute('download')).toBe(true);
  expect(link.getAttribute('href')).toBe(url('data.json'));
});

test('binary under the limit is a download', async () => {
  replies[url('blob.txt')] = { type: 'application/octet-stream', body: 'xx' };
  const { container } = show([{ name: 'blob.txt', file: 'blob.txt', size: 2 }]);
  await waitFor(() => expect(requested).toContain(url('blob.txt')));
  await act(async () => {});
  expect(container.querySelector('code')).toBeNull();
  expect(container.querySelector('details')).toBeNull();
  expect(screen.queryByText(m.previewLoading)).toBeNull();
  expect(screen.getByRole('link', { name: new RegExp(m.download) }).hasAttribute('download')).toBe(
    true,
  );
});

test('failed or missing text fetches end in a download only', async () => {
  // 404: keine Antwort in `replies`; Wurf: Netzwerkfehler.
  const { container } = show([{ name: 'gone.txt', file: 'gone.txt', size: 2 }]);
  await waitFor(() => expect(screen.queryByText(m.previewLoading)).toBeNull());
  expect(container.querySelector('details')).toBeNull();
  expect(screen.getByRole('link', { name: new RegExp(m.download) })).toBeTruthy();
  cleanup();
  vi.stubGlobal('fetch', async () => {
    throw new Error('offline');
  });
  const second = show([{ name: 'x.txt', file: 'x.txt', size: 2 }]);
  await waitFor(() => expect(screen.queryByText(m.previewLoading)).toBeNull());
  expect(second.container.querySelector('details')).toBeNull();
  expect(screen.getByRole('link', { name: new RegExp(m.download) })).toBeTruthy();
});

test('markdown attachments render', async () => {
  replies[url('notes.md')] = { type: 'text/plain; charset=utf-8', body: '# Titel' };
  show([{ name: 'notes.md', file: 'notes.md', size: 7 }]);
  expect((await screen.findByTestId('markdown')).textContent).toBe('# Titel');
});

test('url attachments show their host', () => {
  show([{ name: 'spec', url: 'https://example.com/a/b' }]);
  const link = screen.getByRole('link', { name: /example\.com/ });
  expect(link.getAttribute('href')).toBe('https://example.com/a/b');
  expect(requested).toEqual([]);
});

test('lfs pointers show the pull hint', () => {
  show([{ name: 'big.bin', file: 'big.bin', not_loaded: true }]);
  expect(screen.getByText('git -C /wc lfs pull')).toBeTruthy();
  expect(screen.queryByRole('link', { name: new RegExp(m.download) })).toBeNull();
});

test('renders nothing without attachments', () => {
  const { container } = show([]);
  expect(container.textContent).toBe('');
});
