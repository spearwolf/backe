import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    notABacklog: (source: string, configFile: string) =>
      `${source} is not a backlog: ${configFile} is missing`,
    rootCount: (source: string, count: number) =>
      `History of ${source} has ${count} root commits, expected exactly one`,
    cloneFailed: (source: string, detail: string) => `Clone of ${source} failed: ${detail}`,
    notDescendantOfVerified: (source: string, verified: string) =>
      `${source} is not a descendant of the last verified state ${verified}`,
    formatTooNew: (version: number, supported: number) =>
      `Backlog format ${version} is newer than this backe (${supported}); read-only`,
    removedWhileCloning: (name: string) => `Backlog ${name} was removed while cloning`,
    targetNotAWorkingCopy: (target: string, name: string) =>
      `${target} exists but is not a working copy of ${name}`,
    targetNotAWorkingCopyHint: (target: string) => `Check ${target} and remove it`,
    backlogNameMismatch: (actual: string, requested: string) =>
      `The backlog is named '${actual}', not '${requested}'`,
    backlogNameMismatchHint: 'Omit --name; there are no local alias names in v1.',
    userNotPushed: (handle: string) => `User ${handle} has not been pushed yet`,
    workingCopyMissing: (wc: string) => `Working copy ${wc} is missing`,
    workingCopyMissingHint: (name: string, handle: string, configPath: string) =>
      `backe backlog add ${name} <path> --as ${handle} or remove paths.${handle} in ${configPath}`,
    noCloneSource: (name: string) => `No source to clone backlog ${name} from`,
    noCloneSourceHint: 'backe backlog clone <url>',
    urlBelongsToOtherBacklog: (url: string, actual: string, expected: string) =>
      `${url}: belongs to backlog '${actual}', expected '${expected}'`,
    hubCreated: (hub: string, from: string) =>
      `Local hub ${hub} created; ${from} now syncs through it`,
    workingCopyBelongsToOther: (wc: string, identity: string, handle: string, own: string) =>
      `The working copy ${wc} belongs to '${identity}'; the working copy of '${handle}' is ${own}`,
    pathMustBeAbsolute: (path: string) => `Path must be absolute: ${path}`,
    notAWorkingCopyOf: (
      path: string,
      name: string,
      toplevel: string | undefined,
      actual: string | undefined,
      wanted: string,
    ) =>
      `${path} is not a working copy of backlog '${name}' (git toplevel: ${toplevel ?? 'none'}, backlog: ${actual ?? 'none'}, expected: ${wanted})`,
    boundInManagedDir: (path: string) => `${path} is bound and lies in the managed directory`,
    boundInManagedDirHint: (handle: string, configPath: string) =>
      `Remove paths.${handle} in ${configPath} or move the clone`,
    managedCloneRefused: (clone: string, what: string) => `The managed clone '${clone}' ${what}`,
    purgeForceHint: (name: string) =>
      `backe backlog remove ${name} --purge --force deletes it anyway`,
    cloneHasNoRemote: 'has no remote',
    cloneHasUnpushed: (branches: readonly string[]) =>
      `contains commits that are on no remote (branches: ${branches.map((b) => `'${b}'`).join(', ')})`,
    reregisteredMeanwhile: (name: string) => `Backlog ${name} was registered again in the meantime`,
    rerunPurgeHint: 'run backe backlog remove --purge again',
    backlogNotRegistered: (name: string) => `Backlog '${name}' is not registered`,
  },
  de: {
    notABacklog: (source: string, configFile: string) =>
      `${source} ist kein Backlog: ${configFile} fehlt`,
    rootCount: (source: string, count: number) =>
      `Historie von ${source} hat ${count} Wurzel-Commits, erwartet genau einen`,
    cloneFailed: (source: string, detail: string) =>
      `Clone von ${source} fehlgeschlagen: ${detail}`,
    notDescendantOfVerified: (source: string, verified: string) =>
      `${source} ist kein Nachfahre des zuletzt verifizierten Stands ${verified}`,
    formatTooNew: (version: number, supported: number) =>
      `Backlog-Format ${version} ist neuer als dieses backe (${supported}); nur lesen`,
    removedWhileCloning: (name: string) => `Backlog ${name} wurde während des Klonens entfernt`,
    targetNotAWorkingCopy: (target: string, name: string) =>
      `${target} existiert, ist aber keine Arbeitskopie von ${name}`,
    targetNotAWorkingCopyHint: (target: string) => `${target} prüfen und entfernen`,
    backlogNameMismatch: (actual: string, requested: string) =>
      `Der Backlog heißt »${actual}«, nicht »${requested}«`,
    backlogNameMismatchHint: '--name weglassen; lokale Aliasnamen gibt es in v1 nicht.',
    userNotPushed: (handle: string) => `User ${handle} ist noch nicht gepusht`,
    workingCopyMissing: (wc: string) => `Arbeitskopie ${wc} fehlt`,
    workingCopyMissingHint: (name: string, handle: string, configPath: string) =>
      `backe backlog add ${name} <pfad> --as ${handle} oder paths.${handle} in ${configPath} entfernen`,
    noCloneSource: (name: string) => `Keine Quelle zum Klonen von Backlog ${name}`,
    noCloneSourceHint: 'backe backlog clone <url>',
    urlBelongsToOtherBacklog: (url: string, actual: string, expected: string) =>
      `${url}: gehört zum Backlog »${actual}«, erwartet wurde »${expected}«`,
    hubCreated: (hub: string, from: string) =>
      `Lokaler Hub ${hub} angelegt; ${from} synct jetzt darüber`,
    workingCopyBelongsToOther: (wc: string, identity: string, handle: string, own: string) =>
      `Die Arbeitskopie ${wc} gehört »${identity}«; die Arbeitskopie von »${handle}« ist ${own}`,
    pathMustBeAbsolute: (path: string) => `Pfad muss absolut sein: ${path}`,
    notAWorkingCopyOf: (
      path: string,
      name: string,
      toplevel: string | undefined,
      actual: string | undefined,
      wanted: string,
    ) =>
      `${path} ist keine Arbeitskopie des Backlogs »${name}« (Git-Toplevel: ${toplevel ?? 'keines'}, Backlog: ${actual ?? 'keiner'}, erwartet: ${wanted})`,
    boundInManagedDir: (path: string) =>
      `${path} ist gebunden und liegt im verwalteten Verzeichnis`,
    boundInManagedDirHint: (handle: string, configPath: string) =>
      `paths.${handle} in ${configPath} entfernen oder den Clone verschieben`,
    managedCloneRefused: (clone: string, what: string) => `Der verwaltete Clone »${clone}« ${what}`,
    purgeForceHint: (name: string) =>
      `backe backlog remove ${name} --purge --force löscht trotzdem`,
    cloneHasNoRemote: 'hat keine Remote',
    cloneHasUnpushed: (branches: readonly string[]) =>
      `enthält Commits, die auf keiner Remote liegen (Branches: ${branches.map((b) => `»${b}«`).join(', ')})`,
    reregisteredMeanwhile: (name: string) => `Backlog ${name} wurde inzwischen neu registriert`,
    rerunPurgeHint: 'backe backlog remove --purge erneut ausführen',
    backlogNotRegistered: (name: string) => `Backlog »${name}« ist nicht registriert`,
  },
});
