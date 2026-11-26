import { catchErrAsync } from '../../test/helpers/catch.ts';
import { testBacklog } from '../../test/helpers/git.ts';
import { setLocale } from '../i18n/locale.ts';
import { invokeTool, TOOLS } from './catalog.ts';
import { pendingStarts, type ToolEnv, writeQueue } from './run.ts';

beforeAll(() => setLocale('en'));
afterAll(() => setLocale('de'));

const attachmentAdd = TOOLS.find((t) => t.name === 'attachment_add');

test('attachment_add refuses a path when the adapter has no working directory', async () => {
  const b = await testBacklog();
  // Wie `backe ui`: ohne `cwd`, Uploads kommen als Bytes, nie als Pfad auf dem Server.
  const env: ToolEnv = {
    context: () => b.context(),
    allowDelete: true,
    queue: writeQueue(),
    pending: pendingStarts(),
  };
  if (attachmentAdd === undefined) throw new Error('attachment_add fehlt im Katalog');
  const err = await catchErrAsync(() =>
    invokeTool(attachmentAdd, env, { id: 'bk-zzzzz', name: 'key', path: '.backe/backlog.jsonc' }),
  );
  expect(err.code).toBe('validation');
  expect(err.message).toBe("Parameter 'path' is not available here");
  expect(err.hint).toBe('pass the content via text or json');
});
