/**
 * Misst `applyBatch` mit 1 000 `issue.create` gegen einen Snapshot mit 20 000 Issues im Speicher
 * (Ziel nach backe.md §2.16.6: unter einer Sekunde). Ein Lauf ohne und einer mit `parent` auf
 * ein Bestands-Issue. Aufruf: `node scripts/bench-batch.ts`. Kein Teil von `mise run check`.
 */
import { CROCKFORD } from '../src/core/ids.ts';
import {
  BacklogConfigSchema,
  type Issue,
  IssueSchema,
  type User,
  UserSchema,
} from '../src/core/schemas.ts';
import type { ApplyContext } from '../src/ops/apply.ts';
import { applyBatch } from '../src/ops/batch.ts';
import type { Operation } from '../src/ops/operation.ts';
import { issueFile, userFile } from '../src/store/layout.ts';
import type { BacklogSnapshot, StoredEntity } from '../src/store/snapshot.ts';

const ISSUES = 20_000;
const CREATES = 1_000;

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

/** Formal gültige ed25519-Schlüsselzeile (Typ-Feld plus 32 Null-Bytes). */
function ed25519Key(): string {
  const field = (bytes: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, bytes.length]), bytes]);
  const blob = Buffer.concat([field(Buffer.from('ssh-ed25519')), field(Buffer.alloc(32))]);
  return `ssh-ed25519 ${blob.toString('base64')} spw@host`;
}

function snapshot(): BacklogSnapshot {
  const user = UserSchema.parse({
    name: 'Wolfger',
    kind: 'human',
    keys: [ed25519Key()],
  });
  const issues = new Map<string, StoredEntity<Issue>>();
  const states = ['backlog', 'todo', 'in_progress'];
  for (let i = 0; i < ISSUES; i++) {
    const id = issueId(i);
    const data = IssueSchema.parse({
      id,
      title: `Issue Nummer ${i}`,
      state: states[i % states.length],
      creator: 'spw',
      created: '2026-11-18T11:00:00Z',
    });
    issues.set(id, { data, extra: [], body: `Beschreibung ${i}.\n`, path: issueFile(id) });
  }
  return {
    config: BacklogConfigSchema.parse({
      version: 1,
      name: 'bench',
      id_prefix: 'bk',
      admins: ['spw'],
    }),
    users: new Map<string, StoredEntity<User>>([
      ['spw', { data: user, extra: [], body: '', path: userFile('spw') }],
    ]),
    projects: new Map(),
    sprints: new Map(),
    repos: new Map(),
    issues,
    problems: [],
    attributes: undefined,
  };
}

/**
 * Zufallsquelle, die nie zweimal dieselben Bytes liefert. Das erste Zeichen ist nie `0`, damit
 * keine Bestands-ID (`bk-00…`) getroffen wird; es wechselt reihum, damit die neuen IDs wie echte
 * zufällige über die ganze Schlüsselreihe verteilt landen.
 */
function counterBytes(): (n: number) => Uint8Array {
  let calls = 0;
  return (n) => {
    const k = calls++;
    return Uint8Array.from({ length: n }, (_, i) =>
      i === 0 ? 1 + (k % 31) : Math.floor(k / 32 ** (n - 1 - i)) % 32,
    );
  };
}

function measure(label: string, s: BacklogSnapshot, ops: Operation[]): void {
  const ctx: ApplyContext = {
    actor: 'spw',
    now: '2026-11-19T08:00:00Z',
    randomBytes: counterBytes(),
  };
  const start = performance.now();
  const result = applyBatch(s, ops, ctx);
  const ms = performance.now() - start;
  if (result.changes.length !== CREATES) {
    throw new Error(`${label}: ${result.changes.length} statt ${CREATES} Änderungen`);
  }
  console.log(
    `applyBatch, ${CREATES} issue.create gegen ${ISSUES} Issues, ${label}: ${ms.toFixed(0)} ms`,
  );
}

const s = snapshot();
measure(
  'ohne parent',
  s,
  Array.from({ length: CREATES }, (_, i) => ({ op: 'issue.create', title: `Neu ${i}` })),
);
measure(
  'mit parent',
  s,
  Array.from({ length: CREATES }, (_, i) => ({
    op: 'issue.create',
    title: `Neu ${i}`,
    parent: issueId(i * 7),
  })),
);
