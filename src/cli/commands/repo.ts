/** `backe repo add | list | rm | check | where | scan` (backe.md §2.11, §2.17). */
import type { Command } from 'commander';
import { checkRepoResult, type RepoCheck, repoCheckExit } from '../../services/repo-check.ts';
import { locateRepo, type ScanEntry, scanRepos } from '../../services/repo-local.ts';
import { addRepo, listRepos, removeRepo } from '../../services/repos.ts';
import { nonEmpty, repoLocateJson } from '../../services/views.ts';
import {
  absPath,
  action,
  bodyArg,
  emit,
  emitNotices,
  emitOutcome,
  type Runtime,
  subcommand,
  syncOption,
} from '../options.ts';
import { columns, lines, safeText } from '../output.ts';
import { m } from './repo.messages.ts';

type AddOpts = { name?: string; ref?: string; description?: string };

export function repoCommands(program: Command, rt: Runtime): void {
  const repo = subcommand(program, 'repo', m.description);

  subcommand(repo, 'add <url>', m.addDescription)
    .option('--name <name>', m.nameOption)
    .option('--ref <ref>', m.refOption)
    .option('-d, --description <md|->', m.descriptionOption)
    .action(
      action(
        rt,
        async (env, url: string, opts: AddOpts) => {
          const body = await bodyArg(env, opts);
          const r = await addRepo(await env.context(), {
            url,
            ...(opts.name === undefined ? {} : { name: opts.name }),
            ...(opts.ref === undefined ? {} : { defaultRef: opts.ref }),
            ...(body === undefined ? {} : { body }),
          });
          emitOutcome(env, r, 'other');
        },
        { write: true },
      ),
    );

  syncOption(subcommand(repo, 'list', m.listDescription)).action(
    action(
      rt,
      async (env) => {
        const rows = await listRepos(await env.context());
        // JSON mit den Feldnamen der Repo-Datei (`default_ref`).
        const out = rows.map(({ defaultRef, ...r }) => ({
          name: r.name,
          url: r.url,
          canonical: r.canonical,
          default_ref: defaultRef,
          issues: r.issues,
        }));
        emit(env, out, () =>
          lines(columns(rows.map((r) => [r.name, r.url, r.defaultRef ?? '-', String(r.issues)]))),
        );
      },
      { read: true },
    ),
  );

  subcommand(repo, 'rm <name>', m.rmDescription).action(
    action(
      rt,
      async (env, name: string) => {
        emitOutcome(env, await removeRepo(await env.context(), name), 'other');
      },
      { write: true },
    ),
  );

  subcommand(repo, 'check [name...]', m.checkDescription)
    .option('--remote', m.remoteOption)
    .option('--fresh', m.freshOption)
    .action(
      action(rt, async (env, names: string[], opts: { remote?: boolean; fresh?: boolean }) => {
        const { repos: checks, notices } = await checkRepoResult(await env.context(), {
          names,
          ...(opts.remote === true ? { remote: true } : {}),
          ...(opts.fresh === true ? { fresh: true } : {}),
        });
        emit(env, { repos: checks.map(checkJson), notices: nonEmpty(notices) }, () =>
          lines(checks.flatMap(checkLines)),
        );
        emitNotices(env, notices);
        const failure = repoCheckExit(checks);
        if (failure !== undefined) throw failure;
      }),
    );

  subcommand(repo, 'where <name>', m.whereDescription).action(
    action(rt, async (env, name: string) => {
      const r = await locateRepo(await env.context(), name);
      emit(env, repoLocateJson(r), () => `${safeText(r.path)}\n`);
    }),
  );

  subcommand(repo, m.scanCommand, m.scanDescription)
    .option('--force', m.forceOption)
    .option('--dry-run', m.dryRunOption)
    .action(
      action(rt, async (env, dir: string, opts: { force?: boolean; dryRun?: boolean }) => {
        const entries = await scanRepos(await env.context(), absPath(dir, env.io), {
          ...(opts.force === true ? { force: true } : {}),
          ...(opts.dryRun === true ? { dryRun: true } : {}),
        });
        emit(
          env,
          {
            entries: entries.map(({ name, path, status, previous }) => ({
              name,
              path,
              status,
              previous,
            })),
          },
          () => lines(entries.map((e) => safeText(scanLine(e)))),
        );
      }),
    );
}

function scanLine(e: ScanEntry): string {
  const status =
    e.status === 'differs' ? `${m.scanStatus('differs')} (${e.previous})` : m.scanStatus(e.status);
  return `${e.name}  ${e.path}  ${status}`;
}

function checkJson(c: RepoCheck): Record<string, unknown> {
  return {
    name: c.name,
    url: c.url,
    canonical: c.canonical,
    findings: c.findings,
    github: c.github,
    cached: c.cached,
  };
}

function checkLines(c: RepoCheck): string[] {
  const state = c.findings.some((f) => f.level === 'error')
    ? m.stateError
    : c.findings.some((f) => f.level === 'warning')
      ? m.stateWarning
      : 'ok';
  const out = [`${c.name}  ${state}  ${c.url}`];
  for (const f of c.findings) out.push(`  ${f.level}: ${f.message}`);
  if (c.github !== undefined) {
    out.push(`  github: ${c.github.visibility}${c.github.archived ? m.archived : ''}`);
  }
  if (c.cached !== undefined) out.push(`  ${m.cachedFrom(c.cached)}`);
  return out.map(safeText);
}
