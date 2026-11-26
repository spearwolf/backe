/**
 * SSH-Fingerprint über `node:crypto`. Liegt außerhalb von `ssh.ts`, damit die reine Hülle für das
 * Web-Bundle (backe.md §2.20) keinen Node-Import zieht.
 */
import { createHash } from 'node:crypto';
import { parseSshPublicKey } from './ssh.ts';

/** `SHA256:` + Base64 ohne Padding über den Blob, wie `ssh-keygen -lf`. */
export function sshFingerprint(line: string): string {
  const { blob } = parseSshPublicKey(line);
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
}
