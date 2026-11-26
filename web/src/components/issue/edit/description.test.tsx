import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  button,
  call,
  composer,
  deferred,
  description,
  descriptionBox,
  editDescription,
  expectOneCall,
  flush,
  ID,
  png,
  registerIssueViewHarness,
  served,
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
  await act(async () => first.resolve({ commit: 'u1', id: ID }));
  await waitFor(() => expect(composer().value).toBe('![image-2.png](attachments/image-2.png)'));
  expect(upload.mock.calls).toEqual([
    [ID, 'image.png', a],
    [ID, 'image-2.png', b],
  ]);
  expect(descriptionBox().value).toBe('![image.png](attachments/image.png)');
});

test('saving waits for a running image upload, then sends the link', async () => {
  const gate = deferred<unknown>();
  upload.mockImplementationOnce(() => gate.promise);
  view([testIssue(1)]);
  await flush();
  await userEvent.click(editDescription());
  fireEvent.paste(descriptionBox(), { clipboardData: { files: [png()] } });
  await flush();
  expect(button(m.saveChanges, description()).disabled).toBe(true);
  await act(async () => gate.resolve({ commit: null, id: ID }));
  await waitFor(() => expect(button(m.saveChanges, description()).disabled).toBe(false));
  expect(descriptionBox().value).toBe('![image.png](attachments/image.png)');
  await userEvent.click(button(m.saveChanges, description()));
  expectOneCall('issue_update', { id: ID, body: '![image.png](attachments/image.png)' });
});
