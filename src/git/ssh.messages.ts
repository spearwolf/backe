import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    keyUnreadableNoOutput: (keyPath: string, exitCode: string) =>
      `Key '${keyPath}' is not readable (ssh-keygen without output, exit ${exitCode})`,
    keyEncrypted: (keyPath: string) => `Key '${keyPath}' is encrypted and has no '.pub' next to it`,
    keyUnreadable: (keyPath: string, reason: string) =>
      `Key '${keyPath}' is not readable: ${reason}`,
    keyFileNotFound: (keyPath: string) => `Key file not found: ${keyPath}`,
    keyFileExists: (file: string) => `Key file already exists: ${file}`,
  },
  de: {
    keyUnreadableNoOutput: (keyPath: string, exitCode: string) =>
      `Key »${keyPath}« ist nicht lesbar (ssh-keygen ohne Ausgabe, Exit ${exitCode})`,
    keyEncrypted: (keyPath: string) =>
      `Key »${keyPath}« ist verschlüsselt und hat keine ».pub« daneben`,
    keyUnreadable: (keyPath: string, reason: string) =>
      `Key »${keyPath}« ist nicht lesbar: ${reason}`,
    keyFileNotFound: (keyPath: string) => `Key-Datei nicht gefunden: ${keyPath}`,
    keyFileExists: (file: string) => `Key-Datei existiert bereits: ${file}`,
  },
});
