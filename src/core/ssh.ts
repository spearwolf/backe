import { BackeError } from './errors.ts';
import { m } from './ssh.messages.ts';

const TYPE = 'ssh-ed25519';

/** Base64 (bereits auf Form geprüft) als Bytes, ohne `Buffer`. */
function base64Bytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function latin1(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export type SshPublicKey = { type: 'ssh-ed25519'; blob: Uint8Array; comment?: string };

function invalid(line: string, reason: string): BackeError {
  return new BackeError('validation', m.invalidKey(reason), {
    hint: m.hint,
    details: { line },
  });
}

/** Liest eine Public-Key-Zeile (`ssh-ed25519 <base64> [Kommentar]`); andere Typen werden abgelehnt. */
export function parseSshPublicKey(line: string): SshPublicKey {
  const match = /^\s*(\S+)\s+(\S+)(?:\s+([^\r\n]*?))?\s*$/.exec(line);
  if (!match) throw invalid(line, m.expectedForm);
  const [, type, b64, comment] = match as unknown as [string, string, string, string | undefined];
  if (type !== TYPE) throw invalid(line, m.typeUnsupported(type));
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) {
    throw invalid(line, m.brokenBase64);
  }
  const blob = base64Bytes(b64);
  const typeLength = blob.length >= 4 ? new DataView(blob.buffer).getUint32(0) : -1;
  if (typeLength !== TYPE.length || latin1(blob.subarray(4, 4 + typeLength)) !== TYPE) {
    throw invalid(line, m.keyDataWrongType(TYPE));
  }
  const key: SshPublicKey = { type: TYPE, blob };
  if (comment) key.comment = comment;
  return key;
}

/** Gleicher Typ und gleicher Blob; der Kommentar zählt nicht. */
export function sameKey(a: string, b: string): boolean {
  const ka = parseSshPublicKey(a);
  const kb = parseSshPublicKey(b);
  return ka.type === kb.type && sameBytes(ka.blob, kb.blob);
}
