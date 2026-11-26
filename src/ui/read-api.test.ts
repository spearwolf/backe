import { tempDir } from '../../test/helpers/backlog.ts';
import { testBacklog } from '../../test/helpers/git.ts';
import { startUi, type UiHarness } from '../../test/helpers/ui.ts';
import { backlogsJson, type StartInput } from './context.ts';

let ui: UiHarness;
let input: StartInput;

beforeEach(async () => {
  const t = await testBacklog();
  input = { cwd: await tempDir(), env: t.env, flags: { as: 'spw' } };
  ui = await startUi({ ...input, start: 'acme' });
});
afterEach(() => ui.close());

test('GET /api/backlogs lists the backlogs', async () => {
  const res = await ui.get('/api/backlogs');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
  expect(res.json()).toEqual(await backlogsJson(input, 'acme'));
});

test('a known route kind without a handler yet answers not_found', async () => {
  const res = await ui.get('/api/b/acme/search');
  expect([res.status, res.json().error.code]).toEqual([404, 'not_found']);
});

test('an unknown api path answers not_found', async () => {
  const res = await ui.get('/api/b/acme/nope');
  expect([res.status, res.json().error.code]).toEqual([404, 'not_found']);
});
