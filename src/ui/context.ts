/** Kontext je Backlog für `backe ui` (ui.md §2.1): Start-Backlog, Identität, Backlog-Liste. */

import { type Env, resolveHomes } from '../context/paths.ts';
import { listBacklogs } from '../context/registry.ts';
import { type ResolvedContext, requireWriter, resolveContext } from '../context/resolve.ts';
import { readUserConfig } from '../context/user-config.ts';
import { compareCodeUnits } from '../core/compare.ts';
import { BackeError } from '../core/errors.ts';
import { locale } from '../i18n/locale.ts';
import { headConfig } from '../services/write.ts';
import type { BacklogEntryJson, BacklogsJson } from './api.ts';

export type StartInput = { cwd: string; env: Env; flags: { backlog?: string; as?: string } };

/**
 * Name des Start-Backlogs aus den Start-Eingaben (backe.md §2.14). Wirft `resolveContext` `usage`
 * (kein Backlog angegeben) und ist mindestens ein Backlog registriert, `undefined`. Jeder andere
 * Fehler — und `usage` ohne registrierten Backlog — geht unverändert weiter (Startfehler wie im CLI).
 */
export async function resolveStart(input: StartInput): Promise<string | undefined> {
  try {
    return (await resolveContext(input)).backlog.value;
  } catch (err) {
    if (err instanceof BackeError && err.code === 'usage') {
      const cfg = await readUserConfig(resolveHomes(input.env, input.cwd).backeHome);
      if (listBacklogs(cfg).length > 0) return undefined;
    }
    throw err;
  }
}

/**
 * Kontext einer Anfrage: Für `start` die Start-Eingaben unverändert (so gilt eine gebundene
 * Arbeitskopie im Startverzeichnis); löst das inzwischen einen anderen Namen auf, oder ist `backlog`
 * ein anderer, `{ backlog, as: input.flags.as }`.
 */
export async function uiContext(
  input: StartInput,
  start: string | undefined,
  backlog: string,
): Promise<ResolvedContext> {
  if (backlog === start) {
    const ctx = await resolveContext(input);
    if (ctx.backlog.value === start) return ctx;
  }
  const { as } = input.flags;
  return resolveContext({
    cwd: input.cwd,
    env: input.env,
    flags: { backlog, ...(as === undefined ? {} : { as }) },
  });
}

/** `id_prefix` aus HEAD der Arbeitskopie; ohne Arbeitskopie oder bei `BackeError` `null`. */
async function prefixOf(root: string | undefined): Promise<string | null> {
  if (root === undefined) return null;
  try {
    return (await headConfig(root))?.id_prefix ?? null;
  } catch (err) {
    if (!(err instanceof BackeError)) throw err;
    return null;
  }
}

async function entry(
  input: StartInput,
  start: string | undefined,
  name: string,
): Promise<BacklogEntryJson> {
  const current = name === start;
  try {
    const ctx = await uiContext(input, start, name);
    let canWrite = true;
    try {
      requireWriter(ctx);
    } catch (err) {
      if (!(err instanceof BackeError)) throw err;
      canWrite = false;
    }
    const prefix = await prefixOf(ctx.backlog.root);
    return { name, current, can_write: canWrite, user: ctx.user.value ?? null, prefix };
  } catch (err) {
    if (!(err instanceof BackeError)) throw err;
    return { name, current, can_write: false, user: null, prefix: null };
  }
}

/**
 * Registrierte Backlogs plus `start`, nach Name sortiert. `current` = Start-Backlog; `can_write` =
 * `requireWriter` gelingt; `user` = aufgelöster Handle oder `null`. Scheitert der Kontext eines
 * Backlogs mit einem `BackeError`, steht er mit `can_write: false`, `user: null` in der Liste;
 * jeder andere Fehler ist ein Programmfehler und geht weiter (500). `lang` = `locale()`.
 */
export async function backlogsJson(
  input: StartInput,
  start: string | undefined,
): Promise<BacklogsJson> {
  const cfg = await readUserConfig(resolveHomes(input.env, input.cwd).backeHome);
  const names = new Set(listBacklogs(cfg).map((b) => b.name));
  if (start !== undefined) names.add(start);
  const sorted = [...names].sort(compareCodeUnits);
  const backlogs = await Promise.all(sorted.map((name) => entry(input, start, name)));
  return { backlogs, lang: locale() };
}
