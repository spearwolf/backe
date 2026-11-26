/**
 * Prüfstand für `Writes`: ein Store mit Rev 1 und Deps, deren Antworten der Test einzeln auflöst,
 * dazu Issues, Zustände und Patches in der Form des Servers.
 */
import { BacklogConfigSchema } from '@backe/core/schemas.ts';
import type { IssueJson, PatchJson, StateJson, WriteResultJson } from '@backe/ui/api.ts';
import { Store } from '../data/store.ts';
import { type WriteDeps, Writes } from '../data/writes.ts';

export const id = (n: number) => `bk-t000${n}`;

export function issue(n: number, extra: Partial<IssueJson> = {}): IssueJson {
  return {
    id: id(n),
    title: `Issue ${n}`,
    state: 'todo',
    creator: 'spw',
    created: '2026-11-18T10:00:00Z',
    ...extra,
  } as IssueJson;
}

export function config() {
  const { $schema: _unused, ...rest } = BacklogConfigSchema.parse({
    version: 1,
    name: 'acme',
    id_prefix: 'bk',
    admins: ['spw'],
  });
  return rest;
}

export function state(
  rev: number,
  head: string,
  issues: IssueJson[] = [issue(1), issue(2)],
): StateJson {
  return {
    rev,
    head,
    context: {},
    config: config(),
    issues,
    projects: [],
    sprints: [],
    repos: [],
    users: [],
    problems: [],
    sync: null,
  };
}

export function patch(rev: number, head: string, issues: IssueJson[] = []): PatchJson {
  return { rev, head, upsert: { issues }, remove: {} };
}

export const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

export type Deferred<T> = { resolve: (v: T) => void; reject: (e: unknown) => void };

/** Store mit Rev 1 und Deps, deren Antworten der Test einzeln auflöst. */
export function setup() {
  const store = new Store();
  store.load(state(1, 'h1'));
  const calls: Array<{ name: string; args: unknown } & Deferred<unknown>> = [];
  const uploads: Array<{ id: string; name: string; bytes: Blob } & Deferred<WriteResultJson>> = [];
  const refreshes: Array<() => void> = [];
  const deps: WriteDeps = {
    call: (name, args) =>
      new Promise((resolve, reject) => {
        calls.push({ name, args, resolve: resolve as (v: unknown) => void, reject });
      }),
    upload: (issueId, name, bytes) =>
      new Promise((resolve, reject) => {
        uploads.push({ id: issueId, name, bytes, resolve, reject });
      }),
    refresh: () =>
      new Promise<void>((resolve) => {
        refreshes.push(resolve);
      }),
  };
  const writes = new Writes(store, deps);
  const answer = async (result: unknown) => {
    calls.shift()?.resolve(result);
    await flush();
  };
  const dispose = () => {
    writes.dispose();
    store.dispose();
  };
  return { store, writes, calls, uploads, refreshes, answer, dispose };
}

export const move = new Map<string, Partial<IssueJson>>([[id(1), { state: 'in_progress' }]]);
export const committed = (commit: string | null): WriteResultJson => ({ commit, id: id(1) });
