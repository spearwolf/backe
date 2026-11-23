import { BackeError } from '../core/errors.ts';
import { m } from './message.messages.ts';

export const TRAILER_ACTOR = 'Backe-Actor';
export const TRAILER_OP = 'Backe-Op';

export type CommitMessage = {
  subject: string;
  body?: string;
  trailers: readonly (readonly [string, string])[];
};

const TRAILER_LINE = /^([A-Za-z0-9-]+): (.*)$/;

/** `<subject>\n\n[<body>\n\n]<Key>: <value>\n…`; Subject und Trailer-Werte bleiben einzeilig. */
export function formatCommitMessage(message: CommitMessage): string {
  if (message.subject.trim() === '' || /[\r\n]/.test(message.subject)) {
    throw new BackeError('unexpected', m.subjectNotSingleLine, {
      details: { subject: message.subject },
    });
  }
  const lines: string[] = [];
  for (const [key, value] of message.trailers) {
    if (!/^[A-Za-z0-9-]+$/.test(key) || /[\r\n]/.test(value)) {
      throw new BackeError('unexpected', m.invalidTrailer(key), {
        details: { key, value },
      });
    }
    lines.push(`${key}: ${value}`);
  }
  const body = message.body?.replace(/\n+$/, '');
  let out = `${message.subject}\n\n`;
  if (body) out += `${body}\n\n`;
  if (lines.length > 0) out += `${lines.join('\n')}\n`;
  return out;
}

/** Trailer sind der letzte Absatz, wenn jede seiner Zeilen `Key: value` ist; sonst gibt es keine. */
export function parseCommitMessage(raw: string): {
  subject: string;
  body: string | undefined;
  trailers: Map<string, string[]>;
} {
  const lines = raw.replace(/(\r?\n)+$/, '').split(/\r?\n/);
  const subject = lines[0] ?? '';
  let rest = lines.slice(1);
  while (rest.length > 0 && rest[0]?.trim() === '') rest = rest.slice(1);

  const trailers = new Map<string, string[]>();
  const lastBlank = rest.map((l) => l.trim() === '').lastIndexOf(true);
  const paragraph = rest.slice(lastBlank + 1);
  const matches = paragraph.map((l) => TRAILER_LINE.exec(l));
  if (paragraph.length > 0 && matches.every((x) => x !== null)) {
    for (const x of matches) {
      const key = x?.[1] as string;
      trailers.set(key, [...(trailers.get(key) ?? []), x?.[2] as string]);
    }
    rest = rest.slice(0, Math.max(lastBlank, 0));
  }
  while (rest.length > 0 && rest[rest.length - 1]?.trim() === '') rest = rest.slice(0, -1);
  return { subject, body: rest.length > 0 ? rest.join('\n') : undefined, trailers };
}
