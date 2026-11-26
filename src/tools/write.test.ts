import { catchErr, catchErrAsync } from '../../test/helpers/catch.ts';
import { testBacklog } from '../../test/helpers/git.ts';
import { setLocale } from '../i18n/locale.ts';
import { invokeTool, TOOLS } from './catalog.ts';
import { pendingStarts, type ToolEnv, writeQueue } from './run.ts';
import { rejectBatchOps } from './write.ts';

beforeAll(() => setLocale('en'));
afterAll(() => setLocale('de'));

const attachmentAdd = TOOLS.find((t) => t.name === 'attachment_add');

test('attachment_add refuses a path when the adapter has no working directory', async () => {
  const b = await testBacklog();
  // Wie `backe ui`: ohne `cwd`, Uploads kommen als Bytes, nie als Pfad auf dem Server.
  const env: ToolEnv = {
    context: () => b.context(),
    allowDelete: true,
    surface: 'mcp',
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

test('batch names the mcp door in mcp', () => {
  const err = catchErr(() => rejectBatchOps([{ op: 'project.create' }], false, 'mcp'));
  expect(err.message).toBe("line 1: 'project.create' is not available in MCP mode");
});

test('batch names backe ui in the ui', () => {
  const err = catchErr(() => rejectBatchOps([{ op: 'project.create' }], false, 'ui'));
  expect(err.message).toBe("line 1: 'project.create' is not available in backe ui");
});

test('tool errors speak german under de', async () => {
  setLocale('de');
  try {
    const b = await testBacklog();
    const env: ToolEnv = {
      context: () => b.context(),
      allowDelete: true,
      surface: 'ui',
      queue: writeQueue(),
      pending: pendingStarts(),
    };
    const rank = TOOLS.find((t) => t.name === 'issue_rank');
    if (rank === undefined) throw new Error('issue_rank fehlt im Katalog');
    const err = await catchErrAsync(() => invokeTool(rank, env, { id: 'bk-zzzzz' }));
    expect(err.code).toBe('usage');
    expect(err.message).not.toBe('Give exactly one position');
    expect(err.message).toMatch(/Position/);
  } finally {
    setLocale('en');
  }
});
