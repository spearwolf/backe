import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BackeError } from '../core/errors.ts';
import { gitBytes } from './exec.ts';
import { stateDir } from './local-state.ts';
import { m } from './merge-file.messages.ts';

/** Höchster Exit-Code von `git merge-file`, der noch eine Konfliktzahl meint (mehr Konflikte kappt git). */
const MAX_CONFLICTS = 127;

/**
 * Dreiwege-Textmerge über `git merge-file -p`. `labels` stehen in der Reihenfolge
 * `[ours, base, theirs]` und erscheinen in den Konfliktmarkern. Bei Konflikten ist `clean` false
 * und `content` trägt die Marker; ein Fehler von git (Exit über 127) wird `unexpected`.
 */
export async function mergeText(
  wc: string,
  sides: {
    base: Buffer;
    ours: Buffer;
    theirs: Buffer;
    labels: [string, string, string];
  },
): Promise<{ clean: boolean; content: Buffer }> {
  const dir = join(await stateDir(wc), `merge-${process.pid}-${randomBytes(6).toString('hex')}`);
  await mkdir(dir, { recursive: true });
  try {
    const [ours, base, theirs] = ['ours', 'base', 'theirs'].map((n) => join(dir, n)) as [
      string,
      string,
      string,
    ];
    await Promise.all([
      writeFile(ours, sides.ours),
      writeFile(base, sides.base),
      writeFile(theirs, sides.theirs),
    ]);
    const [lo, lb, lt] = sides.labels;
    const okExitCodes = Array.from({ length: MAX_CONFLICTS }, (_, i) => i + 1);
    const result = await gitBytes(
      [
        '-c',
        'merge.conflictStyle=merge',
        'merge-file',
        '-p',
        '-L',
        lo,
        '-L',
        lb,
        '-L',
        lt,
        '--',
        ours,
        base,
        theirs,
      ],
      { cwd: wc, okExitCodes },
    );
    return { clean: result.exitCode === 0, content: result.stdout };
  } catch (error) {
    if (error instanceof BackeError) throw error;
    throw new BackeError('unexpected', m.failed, {
      details: { cause: String(error) },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
