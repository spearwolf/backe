import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { git } from '../../src/git/exec.ts';
import { tempDir } from './backlog.ts';

type Env = Readonly<Record<string, string | undefined>>;

/** Temp-Verzeichnis (realpath) mit den angegebenen Dateien; `env` zeigt `HOME` auf `<root>/home`. */
export async function contextTree(
  files: Record<string, string> = {},
): Promise<{ root: string; env: Env; at(rel: string): string }> {
  const root = await realpath(await tempDir());
  for (const [rel, content] of Object.entries(files)) {
    const file = join(root, rel);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return { root, env: { HOME: join(root, 'home') }, at: (rel) => join(root, rel) };
}

/** `git init` in `dir` (wird bei Bedarf angelegt) und je ein `git remote add <name> <url>`. */
export async function gitInit(dir: string, remotes: Record<string, string> = {}): Promise<void> {
  await mkdir(dir, { recursive: true });
  await git(['init', '-q'], { cwd: dir });
  for (const [name, url] of Object.entries(remotes)) {
    await git(['remote', 'add', name, url], { cwd: dir });
  }
}
