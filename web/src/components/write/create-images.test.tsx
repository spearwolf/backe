import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  bodyBox,
  createButton,
  dialog,
  inDialog,
  json,
  NEW_ID,
  png,
  queryDialog,
  registerCreateHarness,
  setup,
  titleBox,
  writes,
} from '../../test/create-issue.tsx';
import { m as w } from './write.messages.ts';

// Die Vorschau zeigt, welche Blob-URLs der Dialog dem Renderer gibt.
vi.mock('../../markdown/index.tsx', () => ({
  Markdown: ({ source, local }: { source: string; local?: ReadonlyMap<string, string> }) => (
    <div
      data-testid="markdown"
      data-local={[...(local ?? new Map<string, string>())].map(([k, v]) => `${k}=${v}`).join(' ')}
    >
      {source}
    </div>
  ),
}));

registerCreateHarness();

/** Öffnet den Dialog, setzt einen Titel und fügt die Bilder in die Beschreibung ein. */
async function withImages(user: Awaited<ReturnType<typeof setup>>['user'], names: string[]) {
  await user.keyboard('c');
  await user.type(titleBox(), 'Mit Bildern');
  fireEvent.paste(bodyBox(), { clipboardData: { files: names.map(png) } });
  const last = names.at(-1) as string;
  await waitFor(() => expect(bodyBox().value).toContain(last.toLowerCase()));
}

test('images upload after the issue exists', async () => {
  const { user, revoked } = await setup('/b/acme/backlog');
  await user.keyboard('c');
  await user.type(titleBox(), 'Mit Bildern');
  fireEvent.paste(bodyBox(), { clipboardData: { files: [png('Shot.png'), png('shot.png')] } });
  await waitFor(() => expect(bodyBox().value).toContain('shot-2.png'));
  expect(bodyBox().value).toBe(
    '![shot.png](attachments/shot.png)\n![shot-2.png](attachments/shot-2.png)',
  );
  // Vor dem Anlegen geht nichts zum Server; die Vorschau zeigt die Bilder aus dem Browser.
  expect(writes()).toEqual([]);
  await user.click(inDialog().getByRole('button', { name: w.editorPreview }));
  expect(within(dialog()).getByTestId('markdown').dataset.local).toBe(
    'shot.png=blob:1 shot-2.png=blob:2',
  );
  await user.click(inDialog().getByRole('button', { name: w.editorText }));
  await user.click(createButton());

  await waitFor(() => expect(writes()).toHaveLength(3));
  expect(writes().map((c) => `${c.method} ${c.url}`)).toEqual([
    'POST /api/b/acme/tools/issue_create',
    `PUT /api/b/acme/issues/${NEW_ID}/attachments/shot.png`,
    `PUT /api/b/acme/issues/${NEW_ID}/attachments/shot-2.png`,
  ]);
  expect(writes()[0]?.body).toMatchObject({
    body: expect.stringContaining('attachments/shot-2.png'),
  });
  await waitFor(() => expect(queryDialog()).toBeNull());
  expect(revoked.sort()).toEqual(['blob:1', 'blob:2']);
});

test('an image removed from the text is not uploaded', async () => {
  const { user } = await setup('/b/acme/backlog');
  await withImages(user, ['a.png', 'b.png']);
  // `b.png` steht danach nur noch als HTML-Bild mit Titel im Text: Auch das ist ein Verweis.
  await user.clear(bodyBox());
  await user.type(bodyBox(), '<img src="attachments/b.png" title="B">');
  await user.click(createButton());
  await waitFor(() => expect(queryDialog()).toBeNull());
  expect(writes().map((c) => `${c.method} ${c.url}`)).toEqual([
    'POST /api/b/acme/tools/issue_create',
    `PUT /api/b/acme/issues/${NEW_ID}/attachments/b.png`,
  ]);
});

test('a failed upload keeps the dialog and names the created issue', async () => {
  const { user } = await setup('/b/acme/backlog', {
    answer: (c) =>
      c.method === 'PUT' && c.url.endsWith('/a.png')
        ? json({ error: { code: 'too_large', message: 'Zu groß' } }, 413)
        : undefined,
  });
  await withImages(user, ['a.png', 'b.png']);
  await user.click(createButton());
  const alert = await within(dialog()).findByRole('alert');
  expect(alert.textContent).toContain('Zu groß');
  // Der erste Fehlschlag hält das zweite Bild nicht auf.
  expect(writes().map((c) => c.url.split('/').pop())).toEqual(['issue_create', 'a.png', 'b.png']);
  expect(inDialog().getByText(w.createdUploadFailed(NEW_ID, 1, 2))).toBeTruthy();
  // Das Issue gibt es schon: Ein zweites Anlegen darf es nicht mehr geben.
  expect(inDialog().queryByRole('button', { name: w.create })).toBeNull();
  await user.click(inDialog().getByRole('button', { name: w.dismiss }));
  expect(queryDialog()).toBeNull();
  expect(window.location.pathname).toBe(`/b/acme/issue/${NEW_ID}`);
  expect(writes().filter((c) => c.method === 'POST')).toHaveLength(1);
});

test.each([
  ['Cancel', () => screen.getByRole('button', { name: w.cancel })],
  ['Escape', undefined],
])('blob urls are released on %s without a write', async (_how, button) => {
  const { user, revoked } = await setup('/b/acme/backlog');
  await withImages(user, ['a.png']);
  if (button === undefined) await user.keyboard('{Escape}');
  else await user.click(button());
  expect(queryDialog()).toBeNull();
  expect(revoked).toEqual(['blob:1']);
  expect(writes()).toEqual([]);
});

test('creating waits until a pasted image is linked', async () => {
  const { user } = await setup('/b/acme/backlog');
  await user.keyboard('c');
  await user.type(titleBox(), 'Mit Bild');
  // Der Stapel läuft erst in einer späteren Mikroaufgabe; bis dahin ist »Anlegen« gesperrt.
  fireEvent.paste(bodyBox(), { clipboardData: { files: [png('a.png')] } });
  expect(createButton().disabled).toBe(true);
  // Der Link steht vor dem Ende des Stapels im Text; frei wird »Anlegen« erst danach.
  await waitFor(() => expect(createButton().disabled).toBe(false));
  expect(bodyBox().value).toBe('![a.png](attachments/a.png)');
});

test('a file the dialog does not take never leaves the app', async () => {
  const { user } = await setup('/b/acme/backlog');
  await user.keyboard('c');
  await user.type(titleBox(), 'Entwurf');
  const txt = new File(['t'], 'notes.txt', { type: 'text/plain' });
  // Auf den Editor (er nimmt nur Bilder) und neben ihn: Der Browser darf die Datei nicht öffnen.
  for (const target of [bodyBox(), dialog()]) {
    const drop = createEvent.drop(target, { dataTransfer: { types: ['Files'], files: [txt] } });
    fireEvent(target, drop);
    expect(drop.defaultPrevented).toBe(true);
  }
  expect(titleBox().value).toBe('Entwurf');
  expect(writes()).toEqual([]);
});
