import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../data/api-client.ts';
import {
  button,
  call,
  commentName,
  composer,
  deferred,
  description,
  editDescription,
  expectOneCall,
  flush,
  ID,
  png,
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

test('an edited comment stays until the reload brings it, never the old one', async () => {
  served.comments = [testComment(1, { body: 'Alt' })];
  const { store } = view([testIssue(1)]);
  await flush();
  const own = () => within(region(m.timeline)).getAllByRole('listitem')[0] as HTMLElement;
  await userEvent.click(button(m.editNamed(commentName()), own()));
  const box = within(own()).getByRole('textbox', { name: m.comment });
  await userEvent.clear(box);
  await userEvent.type(box, 'Neu');
  await userEvent.click(button(m.saveChanges, own()));
  await flush();
  // Der Server liefert noch den alten Text: Angezeigt wird trotzdem der gespeicherte.
  expect(within(own()).getByText('Neu')).toBeTruthy();
  expect(within(own()).queryByText('Alt')).toBeNull();
  // Erneut bearbeiten beginnt beim gespeicherten Text.
  await userEvent.click(button(m.editNamed(commentName()), own()));
  expect(
    (within(own()).getByRole('textbox', { name: m.comment }) as HTMLTextAreaElement).value,
  ).toBe('Neu');
  await userEvent.click(button(w.cancel, own()));
  served.comments = [testComment(1, { body: 'Neu' })];
  act(() => {
    store.applyPatch(testPatch(2, { touched: [ID] }));
  });
  await flush();
  expect(within(own()).getByText('Neu')).toBeTruthy();
  // Ein späterer fremder Stand löst den gespeicherten ab.
  served.comments = [testComment(1, { body: 'Fremd' })];
  act(() => {
    store.applyPatch(testPatch(3, { touched: [ID] }));
  });
  await flush();
  expect(within(own()).getByText('Fremd')).toBeTruthy();
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

test('the composer waits for a running image upload, then sends the link', async () => {
  const gate = deferred<unknown>();
  upload.mockImplementationOnce(() => gate.promise);
  view([testIssue(1)]);
  await flush();
  await userEvent.type(composer(), 'Bild: ');
  fireEvent.paste(composer(), { clipboardData: { files: [png()] } });
  await flush();
  expect(button(m.addComment).disabled).toBe(true);
  await act(async () => gate.resolve({ commit: null, id: ID }));
  await waitFor(() => expect(button(m.addComment).disabled).toBe(false));
  expect(composer().value).toBe('Bild: ![image.png](attachments/image.png)');
  await userEvent.click(button(m.addComment));
  expectOneCall('comment_add', { id: ID, body: 'Bild: ![image.png](attachments/image.png)' });
});

test('a comment edit waits for a running image upload, then sends the link', async () => {
  const gate = deferred<unknown>();
  upload.mockImplementationOnce(() => gate.promise);
  served.comments = [testComment(1, { body: 'Alt' })];
  view([testIssue(1)]);
  await flush();
  const own = () => within(region(m.timeline)).getAllByRole('listitem')[0] as HTMLElement;
  await userEvent.click(button(m.editNamed(commentName()), own()));
  const box = () => within(own()).getByRole('textbox', { name: m.comment }) as HTMLTextAreaElement;
  box().setSelectionRange(3, 3);
  fireEvent.paste(box(), { clipboardData: { files: [png()] } });
  await flush();
  expect(button(m.saveChanges, own()).disabled).toBe(true);
  await act(async () => gate.resolve({ commit: null, id: ID }));
  await waitFor(() => expect(button(m.saveChanges, own()).disabled).toBe(false));
  expect(box().value).toBe('Alt![image.png](attachments/image.png)');
  await userEvent.click(button(m.saveChanges, own()));
  expectOneCall('comment_edit', {
    id: ID,
    comment: 'c1.md',
    body: 'Alt![image.png](attachments/image.png)',
  });
});
