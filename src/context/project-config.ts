import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BackeError, schemaError } from '../core/errors.ts';
import {
  type ProjectConfig,
  ProjectConfigSchema,
  type ProjectLocalConfig,
  ProjectLocalConfigSchema,
} from '../core/schemas.ts';
import { readJsonc } from '../store/jsonc.ts';
import { physicalPath } from './paths.ts';
import { m } from './project-config.messages.ts';

export type ProjectConfigLevel = {
  dir: string;
  local?: { file: string; config: ProjectLocalConfig };
  shared?: { file: string; config: ProjectConfig };
};

const SHARED_NAME = '.backlog.jsonc';
const LOCAL_NAME = '.backlog.local.jsonc';

/** Nur `ENOENT`/`ENOTDIR` heißen »keine Datei«; alles andere (z. B. `EACCES`, `EISDIR`) wird weitergereicht. */
async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
    throw error;
  }
}

function hasUserKey(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, 'user');
}

async function readShared(file: string): Promise<ProjectConfigLevel['shared']> {
  const text = await readOptional(file);
  if (text === undefined) return undefined;
  const raw = readJsonc(text, file);
  if (hasUserKey(raw)) {
    throw new BackeError('validation', m.userKeyInSharedConfig(file), { hint: m.userKeyHint });
  }
  const result = ProjectConfigSchema.safeParse(raw);
  if (!result.success) throw schemaError(file, result.error);
  return { file, config: result.data };
}

async function readLocal(file: string): Promise<ProjectConfigLevel['local']> {
  const text = await readOptional(file);
  if (text === undefined) return undefined;
  const result = ProjectLocalConfigSchema.safeParse(readJsonc(text, file));
  if (!result.success) throw schemaError(file, result.error);
  return { file, config: result.data };
}

/**
 * Sucht von `physicalPath(cwd)` aufwärts die erste Ebene mit `.backlog.jsonc` und/oder
 * `.backlog.local.jsonc`. Höhere Ebenen werden weder gesucht noch gemergt.
 */
export async function findProjectConfig(cwd: string): Promise<ProjectConfigLevel | undefined> {
  let dir = await physicalPath(cwd);
  for (;;) {
    // Nacheinander, damit bei zwei kaputten Dateien immer `.backlog.jsonc` zuerst gemeldet wird.
    const shared = await readShared(join(dir, SHARED_NAME));
    const local = await readLocal(join(dir, LOCAL_NAME));
    if (shared || local) {
      return { dir, ...(local ? { local } : {}), ...(shared ? { shared } : {}) };
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
