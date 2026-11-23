import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    signingFailed: (key: string, reason: string) => `Signing with ${key} failed: ${reason}`,
    signingFailedHint: 'Check the key path in identities; a public key needs a running ssh-agent',
    noTreeChange: 'Write without any change to the tree',
    headMoved: 'HEAD moved during the write',
  },
  de: {
    signingFailed: (key: string, reason: string) =>
      `Signieren mit ${key} fehlgeschlagen: ${reason}`,
    signingFailedHint:
      'Key-Pfad in identities prüfen; ein Public Key braucht einen laufenden ssh-agent.',
    noTreeChange: 'Write ohne Änderung am Baum',
    headMoved: 'HEAD hat sich während des Writes bewegt',
  },
});
