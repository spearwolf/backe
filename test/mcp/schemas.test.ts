import { setLocale } from '../../src/i18n/locale.ts';
/**
 * Die Tool-Schemas als Golden-File: Beschreibungen und Parameter sind die Schnittstelle, die ein
 * Agent sieht; jede Änderung daran soll im Review als Diff auftauchen.
 */
import { testBacklog } from '../helpers/git.ts';
import { connectMcp, SPEC_TOOLS } from '../helpers/mcp.ts';

// Der MCP-Modus spricht immer Englisch (backe.md §2.18); `backe mcp` setzt die Locale beim Start.
beforeAll(() => setLocale('en'));
afterAll(() => setLocale('de'));

test('tool schemas match the snapshot', async () => {
  const b = await testBacklog();
  const m = await connectMcp(b, { allowDelete: true });
  try {
    const { tools } = await m.client.listTools();
    const sorted = [...tools].sort((x, y) => (x.name < y.name ? -1 : 1));
    expect(sorted.map((t) => t.name)).toEqual([...SPEC_TOOLS, 'issue_delete'].sort());
    await expect(`${JSON.stringify(sorted, null, 2)}\n`).toMatchFileSnapshot('golden/tools.json');
  } finally {
    await m.close();
  }
});
