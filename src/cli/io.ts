/** Alles, was die CLI von außen braucht; in Tests ersetzbar, in `main.ts` an den Prozess gebunden. */
import type { Env } from '../context/paths.ts';

export type CliIo = {
  /** Argumente nach `backe`, ohne `node` und Skriptpfad. */
  argv: string[];
  env: Env;
  cwd: string;
  stdout(s: string): void;
  stderr(s: string): void;
  readStdin(): Promise<string>;
  /** Ist stdout ein Terminal? Entscheidet über Farben. */
  isTTY: boolean;
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
    stderr: (s) => {
      process.stderr.write(s);
    },
    readStdin: () => readAll(process.stdin),
    isTTY: process.stdout.isTTY === true,
  };
}
