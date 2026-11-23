import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    interruptedWriteNotRecoverable: (wc: string) =>
      `Interrupted write in ${wc} cannot be rolled back`,
    checkStatusThenDelete: (wc: string, journal: string) =>
      `check git -C ${wc} status, then delete ${journal}`,
    keyNotActive: (key: string, handle: string) =>
      `The key ${key} is not an active key of ${handle}`,
    checkIdentityKey: (backlog: string, handle: string, configPath: string) =>
      `check identities.${backlog}.${handle}.key in ${configPath}`,
    backlogFormatTooNew: (version: number, supported: number) =>
      `Backlog format ${version} is newer than this backe (${supported})`,
    updateBackeHint: 'update backe; reading still works.',
    splitChangeHint: 'split the change into two backe commit runs',
    notCheckable: (config: string, reason: string) => `not verifiable: ${config}: ${reason}`,
    quarantineInvalid: (reason: string) => `quarantine.jsonc invalid: ${reason}`,
    notABacklog: (wc: string, config: string) =>
      `${wc} is not a backlog: ${config} is missing in HEAD`,
    stateChangedSinceCheck: 'State has changed since the check',
    verifyWouldReject: (reasons: string) => `verify would reject the commit: ${reasons}`,
    uncommittedChanges: (paths: string) => `Uncommitted changes to ${paths}`,
    stashOrRestore: (wc: string, paths: string) =>
      `git -C ${wc} stash, or git -C ${wc} restore --staged --worktree -- ${paths}`,
  },
  de: {
    interruptedWriteNotRecoverable: (wc: string) =>
      `Unterbrochener Write in ${wc} kann nicht zurückgesetzt werden`,
    checkStatusThenDelete: (wc: string, journal: string) =>
      `git -C ${wc} status prüfen, dann ${journal} löschen`,
    keyNotActive: (key: string, handle: string) =>
      `Der Key ${key} ist kein aktiver Key von ${handle}`,
    checkIdentityKey: (backlog: string, handle: string, configPath: string) =>
      `identities.${backlog}.${handle}.key in ${configPath} prüfen`,
    backlogFormatTooNew: (version: number, supported: number) =>
      `Backlog-Format ${version} ist neuer als dieses backe (${supported})`,
    updateBackeHint: 'backe aktualisieren; lesen geht weiter.',
    splitChangeHint: 'Änderung auf zwei backe commit aufteilen',
    notCheckable: (config: string, reason: string) => `nicht prüfbar: ${config}: ${reason}`,
    quarantineInvalid: (reason: string) => `quarantine.jsonc ungültig: ${reason}`,
    notABacklog: (wc: string, config: string) => `${wc} ist kein Backlog: ${config} fehlt in HEAD`,
    stateChangedSinceCheck: 'Stand hat sich seit der Prüfung geändert',
    verifyWouldReject: (reasons: string) => `verify würde den Commit ablehnen: ${reasons}`,
    uncommittedChanges: (paths: string) => `Ungesicherte Änderungen an ${paths}`,
    stashOrRestore: (wc: string, paths: string) =>
      `git -C ${wc} stash, oder git -C ${wc} restore --staged --worktree -- ${paths}`,
  },
});
