import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    hint: 'backe supports only ssh-ed25519 in v1.',
    invalidKey: (reason: string) => `Invalid SSH public key: ${reason}`,
    expectedForm: 'expected "<type> <base64> [comment]"',
    typeUnsupported: (type: string) => `Type ${type} not supported`,
    brokenBase64: 'Broken base64',
    keyDataWrongType: (type: string) => `Key data does not contain type ${type}`,
  },
  de: {
    hint: 'backe unterstützt in v1 nur ssh-ed25519.',
    invalidKey: (reason: string) => `Ungültiger SSH-Public-Key: ${reason}`,
    expectedForm: 'erwartet "<Typ> <Base64> [Kommentar]"',
    typeUnsupported: (type: string) => `Typ ${type} nicht unterstützt`,
    brokenBase64: 'Base64 kaputt',
    keyDataWrongType: (type: string) => `Schlüsseldaten enthalten nicht den Typ ${type}`,
  },
});
