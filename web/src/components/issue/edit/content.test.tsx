import type { CommentJson } from '@backe/ui/api.ts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../data/api-client.ts';
import {
  call,
  deferred,
  expectOneCall,
  flush,
  ID,
  registerIssueViewHarness,
  served,
  upload,
  view,
} from '../../../test/issue-view.tsx';
import { testIssue, testPatch, tid } from '../../../test/state.ts';
import { m } from '../../../views/issue.messages.ts';
import { m as w } from '../../write/write.messages.ts';

vi.mock('../../../markdown/index.tsx', () => ({
  Markdown: ({ source }: { source: string }) => <div data-testid="markdown">{source}</div>,
}));

registerIssueViewHarness();

const region = (name: string) => screen.getByRole('region', { name });
const description = () => region(m.description);
const descriptionBox = () =>
  within(description()).getByRole('textbox', { name: m.description }) as HTMLTextAreaElement;
const button = (name: string, scope: HTMLElement = document.body) =>
  within(scope).getByRole('button', { name }) as HTMLButtonElement;
const comment = (n: number, extra: Partial<CommentJson> = {}): CommentJson => ({
  file: `c${n}.md`,
  author: 'spw',
  created: '2026-11-20T10:00:00Z',
  body: `Kommentar ${n}`,
  ...extra,
});

test('the description saves with issue_update body', async () => {
  served.body = 'Alt';
  view([testIssue(1)]);
  await flush();
  await userEvent.click(button(m.edit, description()));
  expect(descriptionBox().value).toBe('Alt');
  await userEvent.clear(descriptionBox());
  await userEvent.type(descriptionBox(), 'Neu');
  await userEvent.click(button(m.saveChanges, description()));
  expectOneCall('issue_update', { id: ID, body: 'Neu' });
  await flush();
  expect(within(description()).queryByRole('textbox')).toBeNull();
  expect(document.activeElement).toBe(button(m.edit, description()));

  // »Abbrechen« verwirft den Entwurf ohne Write.
  await userEvent.click(button(m.edit, description()));
  await userEvent.type(descriptionBox(), ' weg');
  await userEvent.click(button(w.cancel, description()));
  expect(within(description()).queryByRole('textbox')).toBeNull();
  expect(within(description()).getByText('Alt')).toBeTruthy();
  expect(call).not.toHaveBeenCalled();
});

test('a body changed meanwhile is never overwritten silently', async () => {
  served.body = 'Basis';
  const { store } = view([testIssue(1)]);
  await flush();
  await userEvent.click(button(m.edit, description()));
  await userEvent.type(descriptionBox(), ' mein');
  served.body = 'Fremd';
  act(() => {
    store.applyPatch(testPatch(2, { touched: [ID] }));
  });
  await flush();
  const notice = within(description()).getByText(m.bodyChanged).closest('[role="status"]');
  expect(notice).not.toBeNull();
  expect(descriptionBox().value).toBe('Basis mein');
  expect(button(m.saveChanges, description()).disabled).toBe(true);
  expect(call).not.toHaveBeenCalled();
  await userEvent.click(button(m.keepMine, description()));
  expectOneCall('issue_update', { id: ID, body: 'Basis mein' });
  await flush();
  expect(within(description()).queryByRole('textbox')).toBeNull();

  // Variante »Verwerfen«: Der Editor schließt, der neue Body steht da, kein Write.
  await userEvent.click(button(m.edit, description()));
  expect(descriptionBox().value).toBe('Fremd');
  await userEvent.type(descriptionBox(), ' auch');
  served.body = 'Dritte';
  act(() => {
    store.applyPatch(testPatch(3, { touched: [ID] }));
  });
  await flush();
  await userEvent.click(button(m.discardReload, description()));
  expect(within(description()).queryByRole('textbox')).toBeNull();
  expect(within(description()).getByText('Dritte')).toBeTruthy();
  expect(within(description()).queryByText(m.bodyChanged)).toBeNull();
  expect(call).not.toHaveBeenCalled();
});

test('a pasted image in the description uploads to the issue', async () => {
  view([testIssue(1, { attachments: [{ name: 'image.png', file: 'image.png' }] })]);
  await flush();
  await userEvent.click(button(m.edit, description()));
  const png = new File(['x'], 'image.png', { type: 'image/png' });
  fireEvent.paste(descriptionBox(), { clipboardData: { files: [png] } });
  await waitFor(() =>
    expect(descriptionBox().value).toBe('![image-2.png](attachments/image-2.png)'),
  );
  expect(upload).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledWith(ID, 'image-2.png', png);
  upload.mockClear();

  // Ein Bild, das auf den Editor fällt, nimmt der Editor; die Drop-Fläche des Tabs endet trotzdem.
  const dropped = new File(['y'], 'image.png', { type: 'image/png' });
  fireEvent.dragOver(descriptionBox(), { dataTransfer: { types: ['Files'], files: [] } });
  expect(screen.getByText(m.dropFiles)).toBeTruthy();
  fireEvent.drop(descriptionBox(), { dataTransfer: { types: ['Files'], files: [dropped] } });
  await flush();
  expect(screen.queryByText(m.dropFiles)).toBeNull();
  expect(upload.mock.calls).toEqual([[ID, 'image-3.png', dropped]]);
  expect(call).not.toHaveBeenCalled();
});

test('a comment is added and the composer clears', async () => {
  view([testIssue(1)]);
  await flush();
  const box = screen.getByRole('textbox', { name: m.newComment }) as HTMLTextAreaElement;
  expect(button(m.addComment).disabled).toBe(true);
  await userEvent.type(box, 'Hallo');
  await userEvent.click(button(m.addComment));
  expectOneCall('comment_add', { id: ID, body: 'Hallo' });
  await flush();
  expect(box.value).toBe('');
  expect(document.activeElement).toBe(box);
});

test('a failed comment keeps the draft and shows the error', async () => {
  call.mockRejectedValueOnce(new ApiError(400, 'invalid', 'Zu lang', 'kürzer fassen'));
  view([testIssue(1)]);
  await flush();
  const box = screen.getByRole('textbox', { name: m.newComment }) as HTMLTextAreaElement;
  await userEvent.type(box, 'Hallo');
  await userEvent.click(button(m.addComment));
  await flush();
  expect(box.value).toBe('Hallo');
  expect(screen.getByText('Zu lang')).toBeTruthy();
  expect(screen.getByText('kürzer fassen')).toBeTruthy();
});

test('own comments can be edited and deleted, others not', async () => {
  served.comments = [
    comment(1, { body: 'Meins' }),
    comment(2, { author: 'ada', body: 'Fremd' }),
    comment(3, { kind: 'transition', from: 'todo', to: 'in_progress', body: 'los' }),
  ];
  view([testIssue(1)]);
  await flush();
  const items = () => within(region(m.timeline)).getAllByRole('listitem');
  expect(items()).toHaveLength(3);
  expect(within(items()[1] as HTMLElement).queryByRole('button')).toBeNull();
  expect(within(items()[2] as HTMLElement).queryByRole('button')).toBeNull();

  const own = () => items()[0] as HTMLElement;
  await userEvent.click(button(m.edit, own()));
  const box = within(own()).getByRole('textbox', { name: m.comment }) as HTMLTextAreaElement;
  expect(box.value).toBe('Meins');
  await userEvent.clear(box);
  await userEvent.type(box, 'Besser');
  await userEvent.click(button(m.saveChanges, own()));
  expectOneCall('comment_edit', { id: ID, comment: 'c1.md', body: 'Besser' });
  await flush();
  expect(within(own()).queryByRole('textbox')).toBeNull();
  expect(document.activeElement).toBe(button(m.edit, own()));

  await userEvent.click(button(m.deleteAction, own()));
  const dialog = screen.getByRole('dialog', { name: m.deleteCommentTitle });
  await userEvent.click(button(m.deleteAction, dialog));
  expectOneCall('comment_delete', { id: ID, comment: 'c1.md' });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('without write access there is no composer, upload or action', async () => {
  served.body = 'Text';
  served.comments = [comment(1)];
  served.attachments = [{ name: 'dump.bin', file: 'dump.bin', size: 3 }];
  view([testIssue(1, { attachments: [{ name: 'dump.bin', file: 'dump.bin' }] })], {}, false);
  await flush();
  expect(screen.queryByRole('textbox', { name: m.newComment })).toBeNull();
  expect(screen.queryByRole('button', { name: m.edit })).toBeNull();
  expect(screen.queryByRole('button', { name: m.upload })).toBeNull();
  expect(screen.queryByLabelText(m.uploadFiles)).toBeNull();
  expect(screen.queryByRole('button', { name: m.remove('dump.bin') })).toBeNull();
  expect(screen.queryByRole('button', { name: m.claim })).toBeNull();
  expect(screen.queryByRole('button', { name: m.deleteIssue })).toBeNull();
  fireEvent.dragOver(screen.getByRole('heading', { level: 1 }), {
    dataTransfer: { types: ['Files'], files: [] },
  });
  expect(screen.queryByText(m.dropFiles)).toBeNull();
});

test('files upload by picker and by drop on the tab', async () => {
  view([testIssue(1)]);
  await flush();
  const a = new File(['a'], 'Notiz.txt', { type: 'text/plain' });
  const b = new File(['b'], 'notiz.txt', { type: 'text/plain' });
  await userEvent.upload(screen.getByLabelText(m.uploadFiles), [a, b]);
  await flush();
  expect(upload.mock.calls).toEqual([
    [ID, 'notiz.txt', a],
    [ID, 'notiz-2.txt', b],
  ]);
  upload.mockClear();

  const target = screen.getByRole('heading', { level: 1 });
  expect(screen.queryByText(m.dropFiles)).toBeNull();
  fireEvent.dragOver(target, { dataTransfer: { types: ['Files'], files: [] } });
  expect(screen.getByText(m.dropFiles)).toBeTruthy();
  const c = new File(['c'], 'Bild.png', { type: 'image/png' });
  const d = new File(['d'], 'bild.png', { type: 'image/png' });
  fireEvent.drop(target, { dataTransfer: { types: ['Files'], files: [c, d] } });
  await flush();
  expect(screen.queryByText(m.dropFiles)).toBeNull();
  expect(upload.mock.calls).toEqual([
    [ID, 'bild.png', c],
    [ID, 'bild-2.png', d],
  ]);
});

test('a drop during a running upload is queued, not lost', async () => {
  const first = deferred<unknown>();
  upload.mockImplementationOnce(() => first.promise);
  view([testIssue(1)]);
  await flush();
  const a = new File(['a'], 'a.txt', { type: 'text/plain' });
  const b = new File(['b'], 'a.txt', { type: 'text/plain' });
  await userEvent.upload(screen.getByLabelText(m.uploadFiles), [a]);
  await flush();
  expect(within(region(m.attachments)).getByText(m.uploading)).toBeTruthy();
  fireEvent.drop(screen.getByRole('heading', { level: 1 }), {
    dataTransfer: { types: ['Files'], files: [b] },
  });
  await flush();
  expect(upload).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve({ commit: null, id: ID }));
  expect(upload.mock.calls).toEqual([
    [ID, 'a.txt', a],
    [ID, 'a-2.txt', b],
  ]);
  expect(within(region(m.attachments)).queryByText(m.uploading)).toBeNull();
});

test('a failed upload shows its error above the list', async () => {
  upload.mockRejectedValueOnce(new ApiError(413, 'too_large', 'Zu groß', 'max_bytes erhöhen'));
  served.attachments = [{ name: 'dump.bin', file: 'dump.bin', size: 3 }];
  view([testIssue(1, { attachments: [{ name: 'dump.bin', file: 'dump.bin' }] })]);
  await flush();
  await userEvent.upload(screen.getByLabelText(m.uploadFiles), [
    new File(['x'], 'gross.bin', { type: 'application/octet-stream' }),
  ]);
  await flush();
  const attachments = region(m.attachments);
  const alert = within(attachments).getByRole('alert');
  expect(alert.textContent).toContain('Zu groß');
  expect(alert.textContent).toContain('max_bytes erhöhen');
  const list = within(attachments).getByRole('list');
  expect(alert.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('an attachment is removed after confirming', async () => {
  served.attachments = [
    { name: 'dump.bin', file: 'dump.bin', size: 3 },
    { name: 'spec', url: 'https://example.com/spec' },
  ];
  view([
    testIssue(1, {
      attachments: [
        { name: 'dump.bin', file: 'dump.bin' },
        { name: 'spec', url: 'https://example.com/spec' },
      ],
    }),
  ]);
  await flush();
  const remove = (name: string) => button(m.remove(name), region(m.attachments));
  expect(remove('spec')).toBeTruthy();
  await userEvent.click(remove('dump.bin'));
  let dialog = screen.getByRole('dialog');
  await userEvent.click(button(w.cancel, dialog));
  expect(call).not.toHaveBeenCalled();

  await userEvent.click(remove('dump.bin'));
  dialog = screen.getByRole('dialog', { name: m.removeAttachmentTitle('dump.bin') });
  await userEvent.click(button(m.removeAction, dialog));
  expectOneCall('attachment_rm', { id: ID, name: 'dump.bin' });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('claim shows progress and the conflict hint', async () => {
  const answer = deferred<unknown>();
  call.mockImplementation(() => answer.promise);
  view([testIssue(1, { state: 'in_progress', assignee: 'ada' })]);
  await flush();
  const claim = button(m.claim);
  await userEvent.click(claim);
  expectOneCall('issue_claim', { id: ID });
  expect(claim.disabled).toBe(true);
  expect(screen.getByText(m.claiming).closest('[role="status"]')).not.toBeNull();
  await act(async () =>
    answer.reject(new ApiError(409, 'conflict', 'Schon vergeben', 'backe issue claim --force')),
  );
  expect(claim.disabled).toBe(false);
  expect(screen.queryByText(m.claiming)).toBeNull();
  expect(screen.getByText('Schon vergeben')).toBeTruthy();
  expect(screen.getByText('backe issue claim --force')).toBeTruthy();
});

test('claim is offered only where it can change the assignee', async () => {
  const offered = async (issue: ReturnType<typeof testIssue>) => {
    cleanup();
    view([issue]);
    await flush();
    return screen.queryByRole('button', { name: m.claim }) !== null;
  };
  expect(await offered(testIssue(1, { state: 'backlog' }))).toBe(true);
  expect(await offered(testIssue(1, { state: 'todo', assignee: 'spw' }))).toBe(true);
  expect(await offered(testIssue(1, { state: 'in_progress', assignee: 'spw' }))).toBe(false);
  expect(await offered(testIssue(1, { state: 'review' }))).toBe(false);
  expect(await offered(testIssue(1, { state: 'done' }))).toBe(false);
  expect(await offered(testIssue(1, { state: 'on_hold', paused_from: 'todo' }))).toBe(false);
});

test('reopen asks for target and reason', async () => {
  view([testIssue(1, { state: 'done' })]);
  await flush();
  await userEvent.click(button(m.reopen));
  const dialog = screen.getByRole('dialog');
  const radios = within(dialog).getAllByRole('radio') as HTMLInputElement[];
  expect(radios.map((r) => r.value)).toEqual(['backlog', 'todo', 'in_progress', 'review']);
  expect(radios[0]?.checked).toBe(true);
  await userEvent.click(within(dialog).getByRole('radio', { name: 'todo' }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: m.reason }), 'nochmal');
  await userEvent.click(button(m.reopen, dialog));
  expectOneCall('issue_reopen', { id: ID, to: 'todo', reason: 'nochmal' });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('delete asks orphan or recursive for sub-issues', async () => {
  view([
    testIssue(1),
    testIssue(2, { title: 'Kind', parent: ID }),
    testIssue(3, { depends_on: [tid(2)] }),
  ]);
  await flush();
  await userEvent.click(button(m.deleteIssue));
  const dialog = screen.getByRole('dialog');
  const confirm = button(m.deleteAction, dialog);
  expect(within(dialog).getByRole('link', { name: /Kind/ })).toBeTruthy();
  expect(confirm.disabled).toBe(true);
  // Mit `recursive` fällt auch das Kind weg; dann verweist Issue 3 auf ein Gelöschtes.
  await userEvent.click(within(dialog).getByRole('radio', { name: m.recursive }));
  expect(within(dialog).getByRole('checkbox', { name: m.forceDelete })).toBeTruthy();
  expect(confirm.disabled).toBe(true);
  await userEvent.click(within(dialog).getByRole('radio', { name: m.orphan }));
  expect(within(dialog).queryByRole('checkbox')).toBeNull();
  expect(confirm.disabled).toBe(false);
  await userEvent.click(confirm);
  expectOneCall('issue_delete', { id: ID, children: 'orphan' });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('delete with references needs force', async () => {
  const { store } = view([testIssue(1), testIssue(2, { title: 'Abhängig', depends_on: [ID] })]);
  await flush();
  await userEvent.click(button(m.deleteIssue));
  const dialog = screen.getByRole('dialog');
  const confirm = button(m.deleteAction, dialog);
  expect(within(dialog).queryByRole('radio')).toBeNull();
  expect(within(dialog).getByRole('link', { name: /Abhängig/ })).toBeTruthy();
  expect(confirm.disabled).toBe(true);
  await userEvent.click(within(dialog).getByRole('checkbox', { name: m.forceDelete }));
  expect(confirm.disabled).toBe(false);
  await userEvent.click(confirm);
  expectOneCall('issue_delete', { id: ID, force: true });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => {
    store.applyPatch(testPatch(2, { remove: { issues: [ID] } }));
  });
  await flush();
  expect(screen.getByText(m.deletedNotice)).toBeTruthy();
  expect(screen.queryByRole('button', { name: m.deleteIssue })).toBeNull();
});
