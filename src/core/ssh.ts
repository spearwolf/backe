import { createHash } from 'node:crypto';
import { BackeError } from './errors.ts';

const TYPE = 'ssh-ed25519';
const HINT = 'backe unterstützt in v1 nur ssh-ed25519.';

export type SshPublicKey = { type: 'ssh-ed25519'; blob: Uint8Array; comment?: string };

function invalid(line: string, reason: string): BackeError {
  return new BackeError('validation', `Ungültiger SSH-Public-Key: ${reason}`, {
    hint: HINT,
    details: { line },
  });
}

/** Liest eine Public-Key-Zeile (`ssh-ed25519 <base64> [Kommentar]`); andere Typen werden abgelehnt. */
export function parseSshPublicKey(line: string): SshPublicKey {
  const match = /^\s*(\S+)\s+(\S+)(?:\s+([^\r\n]*?))?\s*$/.exec(line);
  if (!match) throw invalid(line, 'erwartet "<Typ> <Base64> [Kommentar]"');
  const [, type, b64, comment] = match as unknown as [string, string, string, string | undefined];
  if (type !== TYPE) throw invalid(line, `Typ ${type} nicht unterstützt`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) {
    throw invalid(line, 'Base64 kaputt');
  }
  const blob = Buffer.from(b64, 'base64');
  const typeLength = blob.length >= 4 ? blob.readUInt32BE(0) : -1;
  if (typeLength < 0 || blob.subarray(4, 4 + typeLength).toString('latin1') !== TYPE) {
    throw invalid(line, `Schlüsseldaten enthalten nicht den Typ ${TYPE}`);
  }
  const key: SshPublicKey = { type: TYPE, blob: new Uint8Array(blob) };
  if (comment) key.comment = comment;
  return key;
}

/** `SHA256:` + Base64 ohne Padding über den Blob, wie `ssh-keygen -lf`. */
export function sshFingerprint(line: string): string {
  const { blob } = parseSshPublicKey(line);
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
}

/** Gleicher Typ und gleicher Blob; der Kommentar zählt nicht. */
export function sameKey(a: string, b: string): boolean {
  const ka = parseSshPublicKey(a);
  const kb = parseSshPublicKey(b);
  return ka.type === kb.type && Buffer.from(ka.blob).equals(kb.blob);
}
