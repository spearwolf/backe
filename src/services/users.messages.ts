import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    operatorNeedsAgent: '--operator only applies together with --agent',
    userNotFound: (handle: string) => `User '${handle}' not found`,
    fingerprintTooShort: (fingerprint: string, min: number) =>
      `The fingerprint '${fingerprint}' is too short, at least ${min} characters required`,
    noActiveKeyMatches: (handle: string, fingerprint: string) =>
      `No active key of '${handle}' matches '${fingerprint}'`,
    ambiguousFingerprint: (fingerprint: string, handle: string) =>
      `'${fingerprint}' matches several keys of '${handle}'`,
  },
  de: {
    operatorNeedsAgent: '--operator gilt nur zusammen mit --agent',
    userNotFound: (handle: string) => `User »${handle}« nicht gefunden`,
    fingerprintTooShort: (fingerprint: string, min: number) =>
      `Der Fingerprint »${fingerprint}« ist zu kurz, mindestens ${min} Zeichen nötig`,
    noActiveKeyMatches: (handle: string, fingerprint: string) =>
      `Kein aktiver Key von »${handle}« passt auf »${fingerprint}«`,
    ambiguousFingerprint: (fingerprint: string, handle: string) =>
      `»${fingerprint}« passt auf mehrere Keys von »${handle}«`,
  },
});
