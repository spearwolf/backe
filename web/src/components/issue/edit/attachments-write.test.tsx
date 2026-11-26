import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../data/api-client.ts';
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

test('a removed name is free again once the store has caught up', async () => {
  const { store } = view([testIssue(1)]);
  await flush();
  const first = new File(['1'], 'foo.png', { type: 'image/png' });
  await userEvent.upload(screen.getByLabelText(m.uploadFiles), [first]);
  await flush();
  // Der Patch bringt den Anhang, später entfernt ihn `attachment_rm`.
  act(() => {
    store.applyPatch(
      testPatch(2, {
        upsert: { issues: [testIssue(1, { attachments: [{ name: 'foo.png', file: 'foo.png' }] })] },
      }),
    );
  });
  await flush();
  const second = new File(['2'], 'foo.png', { type: 'image/png' });
  await userEvent.upload(screen.getByLabelText(m.uploadFiles), [second]);
  await flush();
  act(() => {
    store.applyPatch(testPatch(3, { upsert: { issues: [testIssue(1)] } }));
  });
  await flush();
  const third = new File(['3'], 'foo.png', { type: 'image/png' });
  await userEvent.upload(screen.getByLabelText(m.uploadFiles), [third]);
  await flush();
  expect(upload.mock.calls.map(([, name]) => name)).toEqual(['foo.png', 'foo-2.png', 'foo.png']);
});
