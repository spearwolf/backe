/** Gesamtzustand eines Backlogs für `GET /api/b/<b>/state` (ui.md §2.3.1). */
import { join } from 'node:path';
import type { ResolvedContext } from '../context/resolve.ts';
import { sshFingerprint } from '../core/fingerprint.ts';
import type { User } from '../core/schemas.ts';
import { resolveCommit } from '../git/history.ts';
import { syncStatus } from '../services/background.ts';
import { contextInfo } from '../services/context-info.ts';
import { openSnapshot } from '../services/read.ts';
import { contextJson, syncStatusJson } from '../services/views.ts';
import { exists } from '../store/files.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
import type { StateJson, UserJson } from './api.ts';

/** Wie `user show --json` ohne `body`: Fingerprints statt Keys, leere Listen fehlen. */
export function userJson(handle: string, user: User, admins: readonly string[]): UserJson {
  const fingerprints = (user.keys ?? []).map(sshFingerprint);
  const revoked = (user.revoked_keys ?? []).map((r) => ({
    fingerprint: sshFingerprint(r.key),
    revoked: r.revoked,
  }));
  return {
    handle,
    name: user.name,
    kind: user.kind,
    ...(user.operator === undefined ? {} : { operator: user.operator }),
    admin: admins.includes(handle),
    ...(fingerprints.length === 0 ? {} : { fingerprints }),
    ...(revoked.length === 0 ? {} : { revoked }),
  };
}

/** Metadaten aller Entitäten ohne Issue-Bodies; `rev` ist in U1 konstant 0. */
export async function stateJson(ctx: ResolvedContext): Promise<StateJson> {
  const { root, snapshot: s } = await openSnapshot(ctx);
  const { $schema: _schema, ...config } = s.config;
  const wc = ctx.backlog.workingCopy;
  const ownCopy = wc !== undefined && (await exists(join(wc, BACKLOG_CONFIG)));
  return {
    rev: 0,
    head: await resolveCommit(root, 'HEAD'),
    context: contextJson(await contextInfo(ctx)),
    config,
    issues: [...s.issues.values()].map((e) => e.data),
    projects: [...s.projects].map(([path, e]) => ({ path, ...e.data })),
    sprints: [...s.sprints].map(([slug, e]) => ({ slug, ...e.data })),
    repos: [...s.repos].map(([name, e]) => ({ name, ...e.data })),
    users: [...s.users].map(([handle, e]) => userJson(handle, e.data, s.config.admins)),
    problems: s.problems,
    sync: ownCopy ? syncStatusJson(await syncStatus(ctx)) : null,
  };
}
