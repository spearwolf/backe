import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../data/api-client.ts';
import { formatDate } from '../../../lib/format.ts';
import {
  button,
  call,
  deferred,
  expectOneCall,
  flush,
  ID,
  region,
  registerIssueViewHarness,
  served,
  testComment,
  upload,
  view,
} from '../../../test/issue-view.tsx';
import { testIssue, testPatch } from '../../../test/state.ts';
import { m } from '../../../views/issue.messages.ts';
import { m as w } from '../../write/write.messages.ts';

vi.mock('../../../markdown/index.tsx', () => ({
  Markdown: ({ source }: { source: string }) => <div data-testid="markdown">{source}</div>,
}));

registerIssueViewHarness();

const description = () => region(m.description);
const editDescription = () => button(m.editNamed(m.description), description());
const descriptionBox = () =>
  within(description()).getByRole('textbox', { name: m.description }) as HTMLTextAreaElement;
const composer = () => screen.getByRole('textbox', { name: m.newComment }) as HTMLTextAreaElement;
const commentName = (author = 'spw', created = testComment(0).created) =>
  m.commentBy(author, formatDate(created));
const png = (name = 'image.png') => new File([name], name, { type: 'image/png' });

test('the description saves with issue_update body', async () => {
  served.body = 'Alt';
  view([testIssue(1)]);
  await flush();
  await userEvent.click(editDescription());
  expect(descriptionBox().value).toBe('Alt');
  await userEvent.clear(descriptionBox());
  await userEvent.type(descriptionBox(), 'Neu');
  await userEvent.click(button(m.saveChanges, description()));
  expectOneCall('issue_update', { id: ID, body: 'Neu' });
  await flush();
  expect(within(description()).queryByRole('textbox')).toBeNull();
  expect(document.activeElement).toBe(editDescription());

  // »Abbrechen« verwirft den Entwurf ohne Write.
  await userEvent.click(editDescription());
  await userEvent.type(descriptionBox(), ' weg');
  await userEvent.click(button(w.cancel, description()));
  expect(within(description()).queryByRole('textbox')).toBeNull();
  expect(within(description()).getByText('Neu')).toBeTruthy();
  expect(call).not.toHaveBeenCalled();
});

test('the saved description stays until the reload brings it, never the old one', async () => {
  served.body = 'Alt';
  const { store } = view([testIssue(1)]);
  await flush();
  await userEvent.click(editDescription());
  await userEvent.clear(descriptionBox());
  await userEvent.type(descriptionBox(), 'Neu');
  await userEvent.click(button(m.saveChanges, description()));
  await flush();
  // Der Server liefert noch den alten Body: Angezeigt wird trotzdem der gespeicherte.
  expect(within(description()).getByText('Neu')).toBeTruthy();
  expect(within(description()).queryByText('Alt')).toBeNull();
  served.body = 'Neu';
  act(() => {
    store.applyPatch(testPatch(2, { touched: [ID] }));
  });
  await flush();
  expect(within(description()).getByText('Neu')).toBeTruthy();
  // Ein späterer fremder Stand löst den gespeicherten ab.
  served.body = 'Fremd';
  act(() => {
    store.applyPatch(testPatch(3, { touched: [ID] }));
  });
  await flush();
  expect(within(description()).getByText('Fremd')).toBeTruthy();
});

test('a body changed meanwhile is never overwritten silently', async () => {
  served.body = 'Basis';
  const { store } = view([testIssue(1)]);
  await flush();
  await userEvent.click(editDescription());
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
  await userEvent.click(editDescription());
  expect(descriptionBox().value).toBe('Basis mein');
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
  await userEvent.click(editDescription());
  const pasted = png();
  fireEvent.paste(descriptionBox(), { clipboardData: { files: [pasted] } });
  await waitFor(() =>
    expect(descriptionBox().value).toBe('![image-2.png](attachments/image-2.png)'),
  );
  expect(upload.mock.calls).toEqual([[ID, 'image-2.png', pasted]]);
  upload.mockClear();

  // Ein Bild, das auf den Editor fällt, nimmt der Editor; die Drop-Fläche des Tabs endet trotzdem.
  const dropped = png();
  fireEvent.dragOver(descriptionBox(), { dataTransfer: { types: ['Files'], files: [] } });
  expect(screen.getByText(m.dropFiles)).toBeTruthy();
  fireEvent.drop(descriptionBox(), { dataTransfer: { types: ['Files'], files: [dropped] } });
  await flush();
  expect(screen.queryByText(m.dropFiles)).toBeNull();
  expect(upload.mock.calls).toEqual([[ID, 'image-3.png', dropped]]);
  expect(call).not.toHaveBeenCalled();
});

test('a mixed drop on the editor links the images and attaches the other files', async () => {
  view([testIssue(1)]);
  await flush();
  await userEvent.click(editDescription());
  const image = png('shot.png');
  const notes = new File(['n'], 'notes.txt', { type: 'text/plain' });
  fireEvent.drop(descriptionBox(), { dataTransfer: { types: ['Files'], files: [image, notes] } });
  await waitFor(() => expect(descriptionBox().value).toBe('![shot.png](attachments/shot.png)'));
  await flush();
  expect(upload.mock.calls).toEqual([
    [ID, 'shot.png', image],
    [ID, 'notes.txt', notes],
  ]);
});

test('overlapping image uploads from two editors get distinct names', async () => {
  const first = deferred<unknown>();
  upload.mockImplementationOnce(() => first.promise);
  view([testIssue(1)]);
  await flush();
  await userEvent.click(editDescription());
  const a = png();
  const b = png();
  fireEvent.paste(descriptionBox(), { clipboardData: { files: [a] } });
  fireEvent.paste(composer(), { clipboardData: { files: [b] } });
  await flush();
  // Der zweite Upload wartet auf den ersten, statt denselben Namen zu nehmen.
  expect(upload.mock.calls).toEqual([[ID, 'image.png', a]]);
  await act(async () => first.resolve({ commit: null, id: ID }));
  await waitFor(() => expect(composer().value).toBe('![image-2.png](attachments/image-2.png)'));
  expect(upload.mock.calls).toEqual([
    [ID, 'image.png', a],
    [ID, 'image-2.png', b],
  ]);
  expect(descriptionBox().value).toBe('![image.png](attachments/image.png)');
});

test('a comment is added and the composer clears', async () => {
  view([testIssue(1)]);
  await flush();
  expect(button(m.addComment).disabled).toBe(true);
  await userEvent.type(composer(), 'Hallo');
  await userEvent.click(button(m.addComment));
  expectOneCall('comment_add', { id: ID, body: 'Hallo' });
  await flush();
  expect(composer().value).toBe('');
  expect(document.activeElement).toBe(composer());
});

test('a failed comment keeps the draft and shows the error', async () => {
  call.mockRejectedValueOnce(new ApiError(400, 'invalid', 'Zu lang', 'kürzer fassen'));
  view([testIssue(1)]);
  await flush();
  await userEvent.type(composer(), 'Hallo');
  await userEvent.click(button(m.addComment));
  await flush();
  expect(composer().value).toBe('Hallo');
  expect(screen.getByText('Zu lang')).toBeTruthy();
  expect(screen.getByText('kürzer fassen')).toBeTruthy();
});

test('own comments can be edited and deleted, others not', async () => {
  served.comments = [
    testComment(1, { body: 'Meins' }),
    testComment(2, { author: 'ada', body: 'Fremd' }),
    testComment(3, { kind: 'transition', from: 'todo', to: 'in_progress', body: 'los' }),
  ];
  view([testIssue(1)]);
  await flush();
  const items = () => within(region(m.timeline)).getAllByRole('listitem');
  expect(items()).toHaveLength(3);
  expect(within(items()[1] as HTMLElement).queryByRole('button')).toBeNull();
  expect(within(items()[2] as HTMLElement).queryByRole('button')).toBeNull();

  const own = () => items()[0] as HTMLElement;
  const editOwn = () => button(m.editNamed(commentName()), own());
  await userEvent.click(editOwn());
  const box = within(own()).getByRole('textbox', { name: m.comment }) as HTMLTextAreaElement;
  expect(box.value).toBe('Meins');
  await userEvent.clear(box);
  await userEvent.type(box, 'Besser');
  await userEvent.click(button(m.saveChanges, own()));
  expectOneCall('comment_edit', { id: ID, comment: 'c1.md', body: 'Besser' });
  await flush();
  expect(within(own()).queryByRole('textbox')).toBeNull();
  expect(document.activeElement).toBe(editOwn());

  await userEvent.click(button(m.deleteNamed(commentName()), own()));
  const dialog = screen.getByRole('dialog', { name: m.deleteCommentTitle });
  await userEvent.click(button(m.deleteAction, dialog));
  expectOneCall('comment_delete', { id: ID, comment: 'c1.md' });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('open editors disappear when the issue is deleted', async () => {
  served.body = 'Text';
  served.comments = [testComment(1, { body: 'Meins' })];
  const { store } = view([testIssue(1)]);
  await flush();
  await userEvent.click(editDescription());
  const own = within(region(m.timeline)).getAllByRole('listitem')[0] as HTMLElement;
  await userEvent.click(button(m.editNamed(commentName()), own));
  expect(screen.getAllByRole('button', { name: m.saveChanges })).toHaveLength(2);
  act(() => {
    store.applyPatch(testPatch(2, { remove: { issues: [ID] } }));
  });
  await flush();
  expect(screen.getByText(m.deletedNotice)).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: m.saveChanges })).toBeNull();
  expect(screen.queryByRole('button', { name: m.keepMine })).toBeNull();
  expect(within(description()).getByText('Text')).toBeTruthy();
  expect(call).not.toHaveBeenCalled();
});
