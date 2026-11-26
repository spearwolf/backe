import { SPEC_TOOLS } from '../../test/helpers/tools.ts';
import { TOOLS, toolsFor } from './catalog.ts';

const names = (defs: readonly { name: string }[]) => defs.map((t) => t.name).sort();

test('mcp surface lists exactly the spec tools', () => {
  expect(names(toolsFor('mcp', { allowDelete: false }))).toEqual([...SPEC_TOOLS].sort());
  expect(names(toolsFor('mcp', { allowDelete: true }))).toEqual(
    [...SPEC_TOOLS, 'issue_delete'].sort(),
  );
});

test('ui surface gets issue_delete without a gate', () => {
  expect(names(toolsFor('ui', { allowDelete: false }))).toContain('issue_delete');
});

test('ui-only tools never reach mcp', () => {
  const mcp = names(toolsFor('mcp', { allowDelete: true }));
  for (const t of TOOLS.filter((d) => !d.surfaces.includes('mcp'))) {
    expect(mcp).not.toContain(t.name);
  }
});

test('tool names are unique snake_case', () => {
  const all = TOOLS.map((t) => t.name);
  expect(new Set(all).size).toBe(all.length);
  for (const name of all) expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
});
