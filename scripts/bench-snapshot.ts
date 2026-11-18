/**
 * Misst die Ladezeit von `loadSnapshot` an einem synthetischen Backlog.
 * Aufruf: `node scripts/bench-snapshot.ts <n>` (Standard 5000). Kein Teil von `mise run check`.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CROCKFORD, shardOf } from '../src/core/ids.ts';
import { loadSnapshot } from '../src/store/snapshot.ts';

const RUNS = 5;

/** Deterministische ID: der Index in Basis 32 (Crockford), auf fünf Zeichen aufgefüllt. */
function issueId(i: number): string {
  let rest = i;
  let tail = '';
  for (let k = 0; k < 5; k++) {
    tail = CROCKFORD[rest % 32] + tail;
    rest = Math.floor(rest / 32);
  }
  return `bk-${tail}`;
}

async function writeBacklog(root: string, n: number): Promise<void> {
  await mkdir(join(root, '.backe'), { recursive: true });
  await mkdir(join(root, 'users'), { recursive: true });
  await writeFile(
    join(root, '.backe/backlog.jsonc'),
    '{\n  "version": 1,\n  "name": "bench",\n  "id_prefix": "bk",\n  "admins": ["spw"]\n}\n',
  );
  await writeFile(
    join(root, 'users/spw.md'),
    '---\nname: Wolfger\nkind: human\nkeys: [ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDwolfgerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx spw@host]\n---\n',
  );
  const states = ['backlog', 'todo', 'in_progress'];
  for (let i = 0; i < n; i++) {
    const id = issueId(i);
    const dir = join(root, 'issues', shardOf(id), id);
    await mkdir(dir, { recursive: true });
    const text = `---\nid: ${id}\ntitle: Issue Nummer ${i}\nstate: ${states[i % states.length]}\ncreator: spw\ncreated: 2026-11-18T11:00:00Z\n---\nBeschreibung ${i}.\n`;
    await writeFile(join(dir, 'issue.md'), text);
  }
}

const n = Number(process.argv[2] ?? 5000);
if (!Number.isInteger(n) || n < 1) {
  console.error('Aufruf: node scripts/bench-snapshot.ts <n>');
  process.exit(2);
}

const root = await mkdtemp(join(tmpdir(), 'backe-bench-'));
try {
  await writeBacklog(root, n);
  const times: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    const snapshot = await loadSnapshot(root);
    times.push(performance.now() - start);
    if (snapshot.issues.size !== n || snapshot.problems.length > 0) {
      throw new Error(
        `Backlog unvollständig geladen: ${snapshot.issues.size}/${n} Issues, ${snapshot.problems.length} Problems`,
      );
    }
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(RUNS / 2)] ?? 0;
  console.log(`loadSnapshot, ${n} Issues, ${RUNS} Läufe: Median ${median.toFixed(0)} ms`);
  console.log(`Einzelwerte (ms): ${times.map((t) => t.toFixed(0)).join(', ')}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
