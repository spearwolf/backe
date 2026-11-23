import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    noHardlinks: (dir: string) => `File system without hard links: ${dir}`,
    noHardlinksHint: 'Put BACKE_HOME and working copies on a local file system',
    unknownPid: 'unknown',
    lockHeld: (lockPath: string, pid: string | number) => `Lock ${lockPath} held by PID ${pid}`,
    lockHeldOnHost: (lockPath: string, pid: string | number, host: string) =>
      `Lock ${lockPath} held by PID ${pid} on ${host}`,
    lockHolderUnknownHint: (lockPath: string) =>
      `If no backe process is running, delete ${lockPath}`,
    lockForeignHostHint: (lockPath: string) =>
      `If no backe process is running there anymore, delete ${lockPath}`,
    lockOtherProcessHint: 'Is another backe process still running?',
  },
  de: {
    noHardlinks: (dir: string) => `Dateisystem ohne Hardlinks: ${dir}`,
    noHardlinksHint: 'BACKE_HOME und Arbeitskopien auf ein lokales Dateisystem legen.',
    unknownPid: 'unbekannt',
    lockHeld: (lockPath: string, pid: string | number) =>
      `Lock ${lockPath} gehalten von PID ${pid}`,
    lockHeldOnHost: (lockPath: string, pid: string | number, host: string) =>
      `Lock ${lockPath} gehalten von PID ${pid} auf ${host}`,
    lockHolderUnknownHint: (lockPath: string) =>
      `Falls kein backe-Prozess läuft: ${lockPath} löschen.`,
    lockForeignHostHint: (lockPath: string) =>
      `Läuft dort kein backe-Prozess mehr: ${lockPath} löschen.`,
    lockOtherProcessHint: 'Läuft noch ein anderer backe-Prozess?',
  },
});
