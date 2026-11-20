/** Alles, was die CLI von außen braucht; in Tests ersetzbar, in `main.ts` an den Prozess gebunden. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import type { Env } from '../context/paths.ts';

export type CliIo = {
  /** Argumente nach `backe`, ohne `node` und Skriptpfad. */
  argv: string[];
  env: Env;
  cwd: string;
  stdout(s: string): void;
  /** Rohe Bytes nach stdout (Anhänge). */
  stdoutBytes(b: Uint8Array): void;
  stderr(s: string): void;
  readStdin(): Promise<string>;
  /** Ist stdout ein Terminal? Entscheidet über Farben. */
  isTTY: boolean;
  /** Ist stdin ein Terminal? Nur dann darf `VISUAL`/`EDITOR` einen Editor starten. */
  stdinIsTTY: boolean;
  /** Startet `command` über die Shell mit `file` als `$1`, erbt die Ein- und Ausgabe; liefert den Exit-Code. */
  runEditor(command: string, file: string): Promise<number>;
  /** Fragt auf stderr und liest eine Zeile von stdin, getrimmt; am Ende der Eingabe `''`. */
  prompt(question: string): Promise<string>;
};

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function nodeIo(): CliIo {
  return {
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    stdout: (s) => {
      process.stdout.write(s);
    },
    stdoutBytes: (b) => {
      process.stdout.write(b);
    },
    stderr: (s) => {
      process.stderr.write(s);
    },
    readStdin: () => readAll(process.stdin),
    isTTY: process.stdout.isTTY === true,
    stdinIsTTY: process.stdin.isTTY === true,
    runEditor: (command, file) =>
      new Promise((resolve, reject) => {
        const child = spawn('sh', ['-c', `${command} "$1"`, 'backe-editor', file], {
          stdio: 'inherit',
        });
        child.on('error', reject);
        // Ein Signal-Ende hat keinen Exit-Code; es zählt als Fehlschlag.
        child.on('close', (code) => resolve(code ?? 1));
      }),
    prompt: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      const closed = new Promise<string>((resolve) => rl.once('close', () => resolve('')));
      try {
        return (await Promise.race([rl.question(question), closed])).trim();
      } finally {
        rl.close();
      }
    },
  };
}
