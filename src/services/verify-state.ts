/**
 * Users- und Config-Stände der Commits für `verify` (backe.md §2.13) und die Signaturprüfung
 * gegen einen solchen Stand.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import { BackeError } from '../core/errors.ts';
import {
  type BacklogConfig,
  BacklogConfigSchema,
  type User,
  validateEntity,
} from '../core/schemas.ts';
import { sshFingerprint } from '../core/ssh.ts';
import {
  type CommitInfo,
  listTree,
  objectInfo,
  readBlobs,
  type Signature,
  signatures,
} from '../git/history.ts';
import { stateDir } from '../git/local-state.ts';
import { exists, writeFileAtomic } from '../store/files.ts';
import { parseEntityFile } from '../store/frontmatter.ts';
import { readJsonc } from '../store/jsonc.ts';
import { BACKLOG_CONFIG, classifyPath } from '../store/layout.ts';
import { m } from './verify-state.messages.ts';

/** Users- und Config-Stand eines Commits; eine kaputte Config ist ihre Fehlermeldung. */
export type State = { usersTree: string; users: Map<string, User>; config: BacklogConfig | string };

export const REGULAR_FILE = /^100[0-7]{3}$/;

export function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length > 0 ? i.path.join('.') : '<root>'}: ${i.message}`)
    .join('; ');
}

/** JSONC lesen und gegen das Schema prüfen; ein Fehler kommt als Meldung zurück. */
export function parseJsoncAs<T>(schema: z.ZodType<T>, text: string, file: string): T | string {
  try {
    const result = schema.safeParse(readJsonc(text, file));
    return result.success ? result.data : zodMessage(result.error);
  } catch (err) {
    if (err instanceof BackeError) return err.message;
    throw err;
  }
}

async function readUsers(wc: string, tree: string): Promise<Map<string, User>> {
  const files = (await listTree(wc, tree)).filter(
    (e) => REGULAR_FILE.test(e.mode) && classifyPath(`users/${e.name}`).kind === 'user',
  );
  const blobs = await readBlobs(
    wc,
    files.map((e) => e.oid),
  );
  const users = new Map<string, User>();
  for (const { name, oid } of files) {
    const path = `users/${name}`;
    try {
      const { data } = parseEntityFile((blobs.get(oid) as Buffer).toString('utf8'), path);
      users.set(name.slice(0, -'.md'.length), validateEntity('user', data, path).data as User);
    } catch (err) {
      // Eine ungültige User-Datei verleiht keine Rechte; ihr Commit ist schon `nicht prüfbar`.
      if (!(err instanceof BackeError)) throw err;
    }
  }
  return users;
}

/** Stände je Commit; Users-Bäume und Config-Blobs werden je Objekt-ID nur einmal gelesen. */
export async function loadStates(wc: string, shas: readonly string[]): Promise<Map<string, State>> {
  const info = await objectInfo(
    wc,
    shas.flatMap((s) => [`${s}:users`, `${s}:${BACKLOG_CONFIG}`]),
  );
  const usersByTree = new Map<string, Map<string, User>>([['none', new Map()]]);
  const configs = new Map<string, BacklogConfig | string>([['none', m.configMissing]]);
  const states = new Map<string, State>();
  for (const sha of shas) {
    const users = info.get(`${sha}:users`);
    const usersTree = users?.type === 'tree' ? users.oid : 'none';
    if (!usersByTree.has(usersTree)) usersByTree.set(usersTree, await readUsers(wc, usersTree));
    const config = info.get(`${sha}:${BACKLOG_CONFIG}`);
    const configBlob = config?.type === 'blob' ? config.oid : 'none';
    if (!configs.has(configBlob)) {
      const text = (await readBlobs(wc, [configBlob])).get(configBlob) as Buffer;
      configs.set(
        configBlob,
        parseJsoncAs(BacklogConfigSchema, text.toString('utf8'), BACKLOG_CONFIG),
      );
    }
    states.set(sha, {
      usersTree,
      users: usersByTree.get(usersTree) as Map<string, User>,
      config: configs.get(configBlob) as BacklogConfig | string,
    });
  }
  return states;
}

// --- Signaturen -----------------------------------------------------------------------------

/**
 * Cache-Verzeichnis der `allowed_signers`-Dateien; die Endung ist die Formatversion. Ändert sich,
 * was in eine Datei gehört, steigt sie, und alte Caches unter anderem Namen liest niemand mehr.
 */
const ALLOWED_SIGNERS_CACHE = 'allowed_signers.v1';

/** `<stateDir>/allowed_signers.v1/<users-tree>` aus den nicht widerrufenen Keys; einmal je Baum. */
async function allowedSigners(wc: string, state: State): Promise<string> {
  const dir = join(await stateDir(wc), ALLOWED_SIGNERS_CACHE);
  const file = join(dir, state.usersTree);
  if (!(await exists(file))) {
    const lines: string[] = [];
    for (const [handle, user] of state.users) {
      const active = activeFingerprints(user);
      for (const key of user.keys ?? []) {
        if (active.has(sshFingerprint(key))) lines.push(`${handle} namespaces="git" ${key}`);
      }
    }
    await mkdir(dir, { recursive: true });
    await writeFileAtomic(
      file,
      lines
        .sort()
        .map((l) => `${l}\n`)
        .join(''),
    );
  }
  return file;
}

const SSH_SIGNATURE = '-----BEGIN SSH SIGNATURE-----';

function isSshSignature(gpgsig: string | undefined): boolean {
  return gpgsig?.startsWith(SSH_SIGNATURE) === true;
}

/**
 * Nur SSH-Signaturen gehen an git: andere Formate prüfte git gegen fremde Keyrings, und ein
 * unbekanntes Format bricht `git log` ab. Merge-Commits sind ohnehin ungültig.
 */
const checkable = (commit: CommitInfo) =>
  commit.parents.length <= 1 && isSshSignature(commit.gpgsig);

/**
 * Signaturstatus je Commit und Users-Stand. `prefetch` prüft viele Commits mit gleichem Users-Baum
 * in einem git-Aufruf; `of` holt nur nach, was noch fehlt (etwa gegen einen eingefrorenen Stand).
 */
export function signatureCache(wc: string) {
  const byTree = new Map<string, Map<string, Signature>>();
  async function check(state: State, shas: readonly string[]): Promise<void> {
    const known = byTree.get(state.usersTree) ?? new Map<string, Signature>();
    byTree.set(state.usersTree, known);
    const missing = shas.filter((sha) => !known.has(sha));
    if (missing.length === 0) return;
    for (const [sha, sig] of await signatures(wc, missing, await allowedSigners(wc, state))) {
      known.set(sha, sig);
    }
  }
  return {
    async prefetch(entries: readonly { commit: CommitInfo; state: State }[]): Promise<void> {
      const groups = new Map<string, { state: State; shas: string[] }>();
      for (const { commit, state } of entries) {
        if (!checkable(commit)) continue;
        const group = groups.get(state.usersTree) ?? { state, shas: [] };
        group.shas.push(commit.sha);
        groups.set(state.usersTree, group);
      }
      for (const { state, shas } of groups.values()) await check(state, shas);
    },
    async of(commit: CommitInfo, state: State): Promise<Signature | undefined> {
      if (!checkable(commit)) return undefined;
      await check(state, [commit.sha]);
      return byTree.get(state.usersTree)?.get(commit.sha);
    },
  };
}

/** Fingerprints der nicht widerrufenen Keys eines Users. */
export function activeFingerprints(user: User | undefined): Set<string> {
  const revoked = new Set((user?.revoked_keys ?? []).map((r) => sshFingerprint(r.key)));
  return new Set((user?.keys ?? []).map(sshFingerprint).filter((fp) => !revoked.has(fp)));
}

/**
 * Gründe aus Signatur-Header und git-Ergebnis, gegen die Users des Signer-Stands. Ein `G` zählt
 * nur, wenn der Key ein aktiver Key des gemeldeten Prinzipals ist.
 */
export function signatureReasons(
  sig: Signature | undefined,
  gpgsig: string | undefined,
  users: ReadonlyMap<string, User>,
): string[] {
  if (gpgsig === undefined) return [m.unsigned];
  if (!isSshSignature(gpgsig)) return [m.notSshSignature];
  if (sig === undefined || sig.status === 'N') return [m.unsigned];
  if (sig.status === 'B') return [m.signatureInvalid];
  if (sig.status === 'G') {
    return activeFingerprints(users.get(sig.principal)).has(sig.fingerprint)
      ? []
      : [m.keyForeign(sig.fingerprint, sig.principal)];
  }
  if (sig.status === 'E' || sig.fingerprint === '') return [m.signatureUnverifiable];
  for (const [handle, user] of users) {
    if ((user.revoked_keys ?? []).some((r) => sshFingerprint(r.key) === sig.fingerprint)) {
      return [m.keyRevoked(sig.fingerprint, handle)];
    }
  }
  return [m.keyOfNoUser(sig.fingerprint)];
}
