/**
 * Prüfstand für `openSession`: Store-Zustände und Patches in der Form des Servers, ein Event-Stream zum Fernsteuern und ein `fetch`, dessen Antworten der Test einzeln auflöst.
 */
import { BacklogConfigSchema } from '@backe/core/schemas.ts';
import type { IssueJson, PatchJson, StateJson } from '@backe/ui/api.ts';
import { openSession } from '../data/session.ts';
import { fakeEventSources } from './fake-event-source.ts';

export function config() {
  const { $schema: _unused, ...rest } = BacklogConfigSchema.parse({
    version: 1,
    name: 'acme',
    id_prefix: 'bk',
    admins: ['spw'],
  });
  return rest;
}

export function issue(n: number): IssueJson {
  return {
    id: `bk-t000${n}`,
    title: `Issue ${n}`,
    state: 'todo',
    creator: 'spw',
    created: '2026-11-18T10:00:00Z',
  } as IssueJson;
}

export function state(rev: number, issues: IssueJson[] = [issue(1)]): StateJson {
  return {
    rev,
    head: `h${rev}`,
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

export function patch(rev: number, issues: IssueJson[] = []): PatchJson {
  return { rev, head: `h${rev}`, upsert: { issues }, remove: {} };
}

/** `fetch`, dessen Antworten der Test einzeln auflöst; kein echtes Warten. */
export function setup() {
  const sources = fakeEventSources();
  const pending: Array<{ resolve: (r: Response) => void; reject: (e: unknown) => void }> = [];
  const urls: string[] = [];
  const fetch = (url: string) => {
    urls.push(url);
    return new Promise<Response>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  };
  const session = openSession('main', { eventSource: sources.create, fetch });
  const es = () => sources.last();
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const answer = async (s: StateJson | Response) => {
    const next = pending.shift();
    next?.resolve(s instanceof Response ? s : new Response(JSON.stringify(s)));
    await flush();
  };
  return {
    sources,
    session,
    es,
    urls,
    pending,
    answer,
    flush,
    fail: (e: unknown) => pending.shift()?.reject(e),
  };
}

export const hello = (rev: number) => ({ rev, head: `h${rev}` });
