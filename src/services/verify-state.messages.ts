import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    configMissing: 'missing',
    unsigned: 'unsigned',
    notSshSignature: 'Signature is not an SSH signature',
    signatureInvalid: 'Signature invalid',
    keyForeign: (fingerprint: string, principal: string) =>
      `Key ${fingerprint} does not belong to ${principal}`,
    signatureUnverifiable: 'Signature not verifiable (ssh-keygen?)',
    keyRevoked: (fingerprint: string, handle: string) =>
      `Key ${fingerprint} of ${handle} is revoked`,
    keyOfNoUser: (fingerprint: string) => `Key ${fingerprint} belongs to no user`,
  },
  de: {
    configMissing: 'fehlt',
    unsigned: 'unsigniert',
    notSshSignature: 'Signatur ist keine SSH-Signatur',
    signatureInvalid: 'Signatur ungültig',
    keyForeign: (fingerprint: string, principal: string) =>
      `Key ${fingerprint} gehört nicht zu ${principal}`,
    signatureUnverifiable: 'Signatur nicht prüfbar (ssh-keygen?)',
    keyRevoked: (fingerprint: string, handle: string) =>
      `Key ${fingerprint} von ${handle} ist widerrufen`,
    keyOfNoUser: (fingerprint: string) => `Key ${fingerprint} gehört zu keinem User`,
  },
});
