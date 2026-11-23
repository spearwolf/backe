import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    startFailed: (bin: string, cause: string) => `${bin} could not be started: ${cause}`,
    timedOut: (command: string, timeoutMs: number) => `${command}: timed out after ${timeoutMs} ms`,
    binNotFound: (bin: string) => `${bin} not found`,
    binNotFoundHint: (pkg: string) => `Install ${pkg}; backe doctor checks the prerequisites`,
    cwdNotFound: (cwd: string) => `Working directory not found: ${cwd}`,
    killedBySignal: (command: string, signal: string) =>
      `${command} terminated by signal (${signal})`,
    unknownSignal: 'unknown',
  },
  de: {
    startFailed: (bin: string, cause: string) => `${bin} konnte nicht gestartet werden: ${cause}`,
    timedOut: (command: string, timeoutMs: number) =>
      `${command}: Zeitüberschreitung nach ${timeoutMs} ms`,
    binNotFound: (bin: string) => `${bin} nicht gefunden`,
    binNotFoundHint: (pkg: string) =>
      `${pkg} installieren; backe doctor prüft die Voraussetzungen.`,
    cwdNotFound: (cwd: string) => `Arbeitsverzeichnis nicht gefunden: ${cwd}`,
    killedBySignal: (command: string, signal: string) =>
      `${command} durch Signal beendet (${signal})`,
    unknownSignal: 'unbekannt',
  },
});
