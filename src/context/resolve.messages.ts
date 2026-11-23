import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    invalidBacklogName: (file: string) => `${file}: name: not a valid backlog name`,
    invalidHandle: (handle: string, source: string) =>
      `Invalid user handle '${handle}' (source: ${source})`,
    notAWorkingCopy: (path: string, source: string) =>
      `${path} is not a working copy of a backlog (source: ${source})`,
    backlogNotRegistered: (name: string, source: string) =>
      `Backlog '${name}' is not registered (source: ${source})`,
    invalidProjectPath: (value: string, source: string) =>
      `Invalid project path '${value}' (source: ${source})`,
    invalidSprintSlug: (value: string, source: string) =>
      `Invalid sprint slug '${value}' (source: ${source})`,
    repoNotInBacklog: (repo: string, source: string) =>
      `Repo '${repo}' is not in the backlog (source: ${source})`,
    workingCopyOfOtherBacklog: (root: string, actual: string, expected: string) =>
      `${root}: belongs to backlog '${actual}', expected '${expected}'`,
    noBacklogGiven: 'No backlog given',
    noBacklogHint:
      "--backlog <name>, BACKE_BACKLOG, 'backe backlog use <name>' or 'backlog' in a .backlog.jsonc",
    noUserResolved: 'No user resolved; writing needs an identity',
    noUserHint: (file: string) => `--as <handle>, BACKE_USER or 'user' in ${file}`,
    workingCopyOwnedByOther: (workingCopy: string, owner: string, handle: string, own: string) =>
      `The working copy ${workingCopy} belongs to '${owner}'; the working copy of '${handle}' is ${own}`,
    noSigningKey: (handle: string) => `No signing key registered for '${handle}'`,
    noSigningKeyHint: (backlog: string, handle: string, file: string) =>
      `Add identities.${backlog}.${handle} to ${file} or run backe user create-agent`,
    sourceSuffix: (message: string, source: string) => `${message} (source: ${source})`,
  },
  de: {
    invalidBacklogName: (file: string) => `${file}: name: kein gültiger Backlog-Name`,
    invalidHandle: (handle: string, source: string) =>
      `Ungültiger User-Handle »${handle}« (Quelle: ${source})`,
    notAWorkingCopy: (path: string, source: string) =>
      `${path} ist keine Arbeitskopie eines Backlogs (Quelle: ${source})`,
    backlogNotRegistered: (name: string, source: string) =>
      `Backlog »${name}« ist nicht registriert (Quelle: ${source})`,
    invalidProjectPath: (value: string, source: string) =>
      `Ungültiger Projektpfad »${value}« (Quelle: ${source})`,
    invalidSprintSlug: (value: string, source: string) =>
      `Ungültiger Sprint-Slug »${value}« (Quelle: ${source})`,
    repoNotInBacklog: (repo: string, source: string) =>
      `Repo »${repo}« steht nicht im Backlog (Quelle: ${source})`,
    workingCopyOfOtherBacklog: (root: string, actual: string, expected: string) =>
      `${root}: gehört zum Backlog »${actual}«, erwartet wurde »${expected}«`,
    noBacklogGiven: 'Kein Backlog angegeben',
    noBacklogHint:
      '--backlog <name>, BACKE_BACKLOG, »backe backlog use <name>« oder »backlog« in einer .backlog.jsonc',
    noUserResolved: 'Kein User aufgelöst, Schreiben braucht eine Identität',
    noUserHint: (file: string) => `--as <handle>, BACKE_USER oder »user« in ${file}`,
    workingCopyOwnedByOther: (workingCopy: string, owner: string, handle: string, own: string) =>
      `Die Arbeitskopie ${workingCopy} gehört »${owner}«; die Arbeitskopie von »${handle}« ist ${own}`,
    noSigningKey: (handle: string) => `Für »${handle}« ist kein Signing-Key eingetragen`,
    noSigningKeyHint: (backlog: string, handle: string, file: string) =>
      `identities.${backlog}.${handle} in ${file} eintragen oder backe user create-agent`,
    sourceSuffix: (message: string, source: string) => `${message} (Quelle: ${source})`,
  },
});
