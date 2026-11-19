/**
 * `issue show` (backe.md §2.6, §2.22, §2.23): ein Issue mit Vorfahren, Abhängigkeiten,
 * Abhängigen, Sub-Issues, Fortschritt und Kommentaren. Liest nur.
 */
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import type { Comment, Issue } from '../core/schemas.ts';
import { isSettled, type State } from '../core/state.ts';
import { ancestors, graphOf, isUnblockable } from '../ops/graph.ts';
import type { Notice } from '../ops/notice.ts';
import { compareIssues } from '../ops/order.ts';
import { listComments, type StoredEntity } from '../store/snapshot.ts';
import { openSnapshot, resolveIssueRef } from './read.ts';

export type IssueRefView = { id: string; state: State; title: string };

export type CommentView = {
  file: string;
  author: string;
  created: string;
  kind?: 'transition';
  from?: State;
  to?: State;
  body: string;
};

export type IssueDetail = {
  issue: Issue;
  body: string;
  raw: string;
  parents: IssueRefView[];
  dependsOn: IssueRefView[];
  dependents: IssueRefView[];
  children: IssueRefView[];
  progress?: { settled: number; total: number };
  commentsCount: number;
  lastReason?: CommentView;
  comments: CommentView[];
  rawComments: string[];
  notices: Notice[];
};

function commentView(c: StoredEntity<Comment>): CommentView {
  const { author, created, kind, from, to } = c.data;
  return {
    file: basename(c.path),
    author,
    created,
    ...(kind === 'transition' ? { kind, from, to } : {}),
    body: c.body,
  };
}

export async function showIssue(
  ctx: ResolvedContext,
  ref: string,
  opts: { comments?: number | 'all' } = {},
): Promise<IssueDetail> {
  const want = opts.comments ?? 0;
  if (want !== 'all' && (!Number.isInteger(want) || want < 0)) {
    throw new BackeError('validation', `Ungültige Kommentaranzahl: »${want}«`, {
      hint: 'eine Zahl ab 0 oder all angeben',
    });
  }
  const { root, snapshot: s } = await openSnapshot(ctx);
  const id = resolveIssueRef(s, ref);
  const stored = s.issues.get(id) as StoredEntity<Issue>;
  const issue = stored.data;
  const view = (other: string): IssueRefView => {
    const o = s.issues.get(other)?.data as Issue;
    return { id: o.id, state: o.state, title: o.title };
  };
  const sorted = (ids: readonly string[] | undefined): IssueRefView[] =>
    (ids ?? [])
      .flatMap((x) => s.issues.get(x)?.data ?? [])
      .sort(compareIssues)
      .map((i) => view(i.id));

  const graph = graphOf(s);
  const childIds = graph.children.get(id) ?? [];
  const settled = childIds.filter((c) => {
    const st = s.issues.get(c)?.data.state;
    return st !== undefined && isSettled(st);
  }).length;

  const all = await listComments(root, id);
  const lastTransition = all.findLast((c) => c.data.kind === 'transition');
  const lastReason =
    lastTransition?.data.to === issue.state ? commentView(lastTransition) : undefined;
  const picked = want === 'all' ? all : want === 0 ? [] : all.slice(-want);

  const notices: Notice[] = [];
  const odd = (issue.depends_on ?? []).filter((d) => {
    const st = s.issues.get(d)?.data.state;
    return st === 'cancelled' || st === 'rejected';
  });
  if (odd.length > 0) {
    notices.push({
      code: 'settled_dependency',
      message: `${id} hängt von abgebrochenen oder abgelehnten Issues ab: ${odd.join(', ')}`,
      ids: odd,
    });
  }
  if (isUnblockable(s, id)) {
    notices.push({
      code: 'unblockable',
      message: `Alle Blocker erledigt, entblockbar: ${id}`,
      ids: [id],
    });
  }

  return {
    issue,
    body: stored.body,
    raw: await readFile(join(root, stored.path), 'utf8'),
    parents: ancestors(s, id).map(view),
    dependsOn: (issue.depends_on ?? []).map(view),
    dependents: sorted(graph.dependents.get(id)),
    children: sorted(childIds),
    ...(childIds.length > 0 ? { progress: { settled, total: childIds.length } } : {}),
    commentsCount: all.length,
    ...(lastReason ? { lastReason } : {}),
    comments: picked.map(commentView),
    rawComments: await Promise.all(picked.map((c) => readFile(join(root, c.path), 'utf8'))),
    notices,
  };
}
