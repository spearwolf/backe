import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    fetchFailed: (remote: string, detail: string) => `Fetch from '${remote}' failed: ${detail}`,
    dirtyBlocksSync: (paths: string) => `Uncommitted changes to ${paths} block the sync`,
    dirtyHint: (wc: string) => `backe commit or git -C ${wc} stash`,
    replayRejected: (reasons: string) => `verify would reject the re-signed commits: ${reasons}`,
    replayRejectedHint: (identityKey: string, configPath: string, userFile: string) =>
      `Check ${identityKey} in ${configPath} and ${userFile} in the remote state`,
    signerNotAUser: (handle: string, tip: string) => `${handle} is not a user as of ${tip}`,
    signerKeyRevoked: (fingerprint: string, handle: string) =>
      `Key ${fingerprint} of ${handle} is revoked`,
    signerKeyForeign: (fingerprint: string, handle: string) =>
      `Key ${fingerprint} does not belong to ${handle}`,
    lfsPushFailed: (remote: string, detail: string) => `LFS push to '${remote}' failed: ${detail}`,
    pushFailed: (remote: string, detail: string) => `Push to '${remote}' failed: ${detail}`,
    pushRejectedAfterRounds: (rounds: number) => `Push rejected after ${rounds} rounds`,
  },
  de: {
    fetchFailed: (remote: string, detail: string) =>
      `Fetch von ${remote} fehlgeschlagen: ${detail}`,
    dirtyBlocksSync: (paths: string) => `Ungesicherte Änderungen an ${paths} verhindern den Sync`,
    dirtyHint: (wc: string) => `backe commit oder git -C ${wc} stash`,
    replayRejected: (reasons: string) =>
      `verify würde die neu signierten Commits ablehnen: ${reasons}`,
    replayRejectedHint: (identityKey: string, configPath: string, userFile: string) =>
      `${identityKey} in ${configPath} und ${userFile} im Remote-Stand prüfen`,
    signerNotAUser: (handle: string, tip: string) => `${handle} ist im Stand von ${tip} kein User`,
    signerKeyRevoked: (fingerprint: string, handle: string) =>
      `Key ${fingerprint} von ${handle} ist widerrufen`,
    signerKeyForeign: (fingerprint: string, handle: string) =>
      `Key ${fingerprint} gehört nicht zu ${handle}`,
    lfsPushFailed: (remote: string, detail: string) =>
      `LFS-Push nach ${remote} fehlgeschlagen: ${detail}`,
    pushFailed: (remote: string, detail: string) => `Push nach ${remote} fehlgeschlagen: ${detail}`,
    pushRejectedAfterRounds: (rounds: number) => `Push nach ${rounds} Runden abgelehnt`,
  },
});
