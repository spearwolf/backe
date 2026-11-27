/**
 * Lebenszeichen fremder Prozesse für Tests, ohne `kill -0` zu pollen: Ein Prozess öffnet eine FIFO
 * zum Schreiben, schreibt seine PID hinein und hält sie offen, solange er lebt. Der Test liest die
 * PID, sobald sie da ist, und das Dateiende, sobald der letzte Schreiber beendet ist — beides sind
 * Ereignisse, keine Fristen. Jede offene FIFO hält einen Thread des libuv-Pools (Default 4) in
 * `open` oder `read` fest; ein Test öffnet darum höchstens eine zugleich.
 */
import { execFileSync } from 'node:child_process';
import { closeSync, constants, createReadStream, openSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach } from 'vitest';

export type Lifeline = {
  /** Pfad der FIFO; der beobachtete Prozess öffnet sie zum Schreiben. */
  path: string;
  /** Die erste Zeile, die der Prozess schreibt, als Zahl. */
  pid: Promise<number>;
  /** Erfüllt sich, sobald kein Prozess die FIFO mehr offen hält, also alle Schreiber beendet sind. */
  gone: Promise<void>;
};

const open: string[] = [];

afterEach(() => {
  // Kam nie ein Schreiber, hängt der Lesende in `open`; ein kurzer Schreiber gibt ihn frei.
  for (const path of open.splice(0)) {
    try {
      closeSync(openSync(path, constants.O_WRONLY | constants.O_NONBLOCK));
    } catch {
      // Niemand liest mehr: nichts freizugeben.
    }
  }
});

/**
 * Eine FIFO `<dir>/<name>`, deren gesamten Inhalt `text` liefert, sobald der letzte Schreiber sie
 * schließt; für ein Programm, das sein Ergebnis in eine Datei schreibt, statt zu warten, bis die
 * Datei erscheint.
 */
export function fifoText(dir: string, name: string): { path: string; text: Promise<string> } {
  const path = join(dir, name);
  execFileSync('mkfifo', [path]);
  open.push(path);
  const stream = createReadStream(path, { encoding: 'utf8' });
  const text = new Promise<string>((resolve, reject) => {
    let all = '';
    stream.on('data', (chunk) => {
      all += chunk;
    });
    stream.on('end', () => resolve(all));
    stream.on('error', reject);
  });
  return { path, text };
}

/** Legt die FIFO `<dir>/<name>` an und beginnt zu lesen. */
export function lifeline(dir: string, name = 'lifeline'): Lifeline {
  const path = join(dir, name);
  execFileSync('mkfifo', [path]);
  open.push(path);
  const stream = createReadStream(path, { encoding: 'utf8' });
  let text = '';
  let gotPid!: (pid: number) => void;
  let failPid!: (err: Error) => void;
  const pid = new Promise<number>((resolve, reject) => {
    gotPid = resolve;
    failPid = reject;
  });
  const gone = new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk) => {
      text += chunk;
      const line = text.split('\n', 2);
      if (line.length === 2) gotPid(Number(line[0]));
    });
    stream.on('end', () => {
      failPid(new Error(`lifeline ${path} ended before a pid line: ${JSON.stringify(text)}`));
      resolve();
    });
    stream.on('error', (err) => {
      failPid(err);
      reject(err);
    });
  });
  // Nur wer darauf wartet, sieht die Ablehnung; ein Test, der nur `gone` braucht, nicht.
  pid.catch(() => {});
  return { path, pid, gone };
}
