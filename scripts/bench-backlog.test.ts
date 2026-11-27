import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSettled, type State } from '../src/core/state.ts';
import { loadSnapshot } from '../src/store/snapshot.ts';
import {
  BENCH_PROJECTS,
  BENCH_SPRINTS,
  benchId,
  benchIssue,
  writeBenchFiles,
} from './bench-backlog.ts';

const SHARES: Record<State, number> = {
  done: 45,
  backlog: 20,
  todo: 13,
  in_progress: 8,
  review: 5,
  blocked: 3,
  on_hold: 2,
  cancelled: 2,
  rejected: 2,
};

const N = 10_000;
const all = Array.from({ length: N }, (_, i) => benchIssue(i, N));

test('the state shares match the plan', () => {
  const counts = new Map<string, number>();
  for (const issue of all)
    counts.set(issue.state as string, (counts.get(issue.state as string) ?? 0) + 1);
  for (const [state, share] of Object.entries(SHARES)) {
    expect(Math.abs(((counts.get(state) ?? 0) / N) * 100 - share)).toBeLessThanOrEqual(1);
  }
  expect([...counts.keys()].sort()).toEqual(Object.keys(SHARES).sort());
});

test('done issues sit in closed sprints', () => {
  const closed = new Set(BENCH_SPRINTS.filter((s) => s.closed).map((s) => s.slug));
  const open = new Set(BENCH_SPRINTS.filter((s) => !s.closed).map((s) => s.slug));
  expect(closed.size).toBe(10);
  expect(open.size).toBe(2);
  expect(BENCH_PROJECTS).toHaveLength(10);
  let unplanned = 0;
  let openIssues = 0;
  for (const issue of all) {
    const sprints = (issue.sprints as string[] | undefined) ?? [];
    if (isSettled(issue.state as State)) {
      expect(sprints).toHaveLength(1);
      expect(closed.has(sprints[0] as string)).toBe(true);
    } else {
      openIssues++;
      if (sprints.length === 0) unplanned++;
      else expect(sprints.every((s) => open.has(s))).toBe(true);
    }
  }
  // Offene zu zwei Dritteln in den offenen Sprints, ± 1 Prozentpunkt.
  expect(Math.abs(unplanned / openIssues - 1 / 3)).toBeLessThan(0.01);
});

test('dependencies point backwards', () => {
  const index = new Map(all.map((issue, i) => [issue.id, i]));
  let deps = 0;
  all.forEach((issue, i) => {
    for (const key of ['depends_on', 'blocked_by'] as const) {
      for (const id of (issue[key] as string[] | undefined) ?? []) {
        deps++;
        expect(index.get(id)).toBeLessThan(i);
      }
    }
  });
  expect(deps).toBeGreaterThan(N / 17);
  expect(benchId(N - 1)).toBe(all[N - 1]?.id);
});

test('a small bench backlog loads without problems', async () => {
  const root = await mkdtemp(join(tmpdir(), 'backe-bench-backlog-'));
  try {
    await mkdir(join(root, '.backe'), { recursive: true });
    await mkdir(join(root, 'users'), { recursive: true });
    await writeFile(
      join(root, '.backe/backlog.jsonc'),
      '{\n  "version": 1,\n  "name": "bench",\n  "id_prefix": "bk",\n  "admins": ["spw"]\n}\n',
    );
    // Ohne Key: Der Stub aus `bench-snapshot.ts` trägt einen Key, dessen Base64 nicht aufgeht.
    await writeFile(join(root, 'users/spw.md'), '---\nname: Wolfger\nkind: human\n---\n');
    await writeBenchFiles(root, 60, 0, 25);
    await writeBenchFiles(root, 60, 25, 60);
    const snapshot = await loadSnapshot(root);
    expect(snapshot.problems).toEqual([]);
    expect(snapshot.issues.size).toBe(60);
    expect(snapshot.sprints.size).toBe(12);
    expect(snapshot.projects.size).toBe(10);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
