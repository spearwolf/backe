import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    backlogNotRegistered: (name: string) => `Backlog '${name}' is not registered`,
    pathNeedsUser: `--path needs --user (handle) that owns the path`,
    backlogOtherRemote: (name: string, remote: string) =>
      `Backlog '${name}' is already registered with a different remote: ${remote}`,
    remoteAlreadyRegistered: (other: string) =>
      `The remote is already registered as backlog '${other}'`,
    handleAlreadyBound: (handle: string, name: string, bound: string) =>
      `'${handle}' is already bound to ${bound} in ${name}`,
    handleAlreadyBoundHint: (handle: string, configPath: string) =>
      `Change or remove paths.${handle} in ${configPath}`,
  },
  de: {
    backlogNotRegistered: (name: string) => `Backlog »${name}« ist nicht registriert`,
    pathNeedsUser: `--path braucht --user (Handle), dem der Pfad gehört`,
    backlogOtherRemote: (name: string, remote: string) =>
      `Backlog »${name}« ist bereits mit einer anderen Remote registriert: ${remote}`,
    remoteAlreadyRegistered: (other: string) =>
      `Die Remote ist bereits als Backlog »${other}« registriert`,
    handleAlreadyBound: (handle: string, name: string, bound: string) =>
      `»${handle}« ist in ${name} schon an ${bound} gebunden`,
    handleAlreadyBoundHint: (handle: string, configPath: string) =>
      `paths.${handle} in ${configPath} ändern oder entfernen`,
  },
});
