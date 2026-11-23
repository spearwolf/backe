import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    userNotFound: (handle: string) => `User ${handle} not found`,
    parentProjectNotFound: (parent: string) => `Parent project ${parent} not found`,
    invalidProjectPath: (path: string) => `Invalid project path '${path}'`,
    invalidProjectPathHint: 'Segments of a-z, 0-9 and "-", at most five levels.',
    projectExists: (path: string) => `Project ${path} already exists`,
    cannotMove: (from: string, to: string) => `${from} cannot be moved to ${to}`,
    cannotMoveHint: "The target is inside the project's own subtree.",
    projectUnreadable: (key: string, reason: string) => `Project ${key} is not readable: ${reason}`,
    projectUnreadableHint: 'Repair the file first; until then the subtree cannot be moved.',
    pathTooDeep: (from: string, to: string) => `${from} would move to ${to}, the path is too deep`,
    hasSubprojects: (path: string, list: string) => `${path} has subprojects: ${list}`,
    hasSubprojectsHint: 'Remove or move the subprojects first.',
    cannotReassignToSelf: (path: string) => `${path} cannot be reassigned to itself`,
    projectStillReferenced: (path: string, list: string) =>
      `${path} is still referenced by ${list}`,
    projectStillReferencedHint: 'Reassign with --reassign <project> or detach with --detach.',
    sprintExists: (slug: string) => `Sprint ${slug} already exists`,
    sprintCarryOverToSelf: (slug: string) => `Sprint ${slug} cannot be carried over into itself`,
    urlAlreadyRegistered: (name: string) => `The URL is already registered as repo ${name}`,
    repoExists: (name: string) => `Repo ${name} already exists`,
    repoStillReferenced: (name: string, list: string) =>
      `Repo ${name} is still referenced by ${list}`,
    repoStillReferencedHint: 'Remove the links first (issue unlink).',
    userExists: (handle: string) => `User ${handle} already exists`,
    userLacksKey: (handle: string) => `User ${handle} does not have this key`,
    adminCannotBeRemoved: (handle: string) => `${handle} is an admin and cannot be removed`,
    adminCannotBeRemovedHint: 'Revoke the admin role in the config first.',
    bodyChanged: (label: string) => `${label}: body has been changed in the meantime`,
  },
  de: {
    userNotFound: (handle: string) => `User ${handle} nicht gefunden`,
    parentProjectNotFound: (parent: string) => `Elternprojekt ${parent} nicht gefunden`,
    invalidProjectPath: (path: string) => `Ungültiger Projekt-Pfad »${path}«`,
    invalidProjectPathHint: 'Segmente aus a-z, 0-9 und "-", höchstens fünf Ebenen.',
    projectExists: (path: string) => `Projekt ${path} existiert bereits`,
    cannotMove: (from: string, to: string) => `${from} kann nicht nach ${to} verschoben werden`,
    cannotMoveHint: 'Das Ziel liegt im Teilbaum des Projekts selbst.',
    projectUnreadable: (key: string, reason: string) =>
      `Projekt ${key} ist nicht lesbar: ${reason}`,
    projectUnreadableHint:
      'Erst die Datei reparieren; bis dahin lässt sich der Teilbaum nicht verschieben.',
    pathTooDeep: (from: string, to: string) =>
      `${from} würde nach ${to} wandern, der Pfad ist zu tief`,
    hasSubprojects: (path: string, list: string) => `${path} hat Unterprojekte: ${list}`,
    hasSubprojectsHint: 'Erst die Unterprojekte entfernen oder verschieben.',
    cannotReassignToSelf: (path: string) => `${path} kann nicht auf sich selbst umgehängt werden`,
    projectStillReferenced: (path: string, list: string) =>
      `${path} wird noch referenziert von ${list}`,
    projectStillReferencedHint: 'Mit --reassign <projekt> umhängen oder mit --detach lösen.',
    sprintExists: (slug: string) => `Sprint ${slug} existiert bereits`,
    sprintCarryOverToSelf: (slug: string) =>
      `Sprint ${slug} kann nicht in sich selbst übernommen werden`,
    urlAlreadyRegistered: (name: string) => `Die URL ist schon als Repo ${name} registriert`,
    repoExists: (name: string) => `Repo ${name} existiert bereits`,
    repoStillReferenced: (name: string, list: string) =>
      `Repo ${name} wird noch referenziert von ${list}`,
    repoStillReferencedHint: 'Erst die Verknüpfungen lösen (issue unlink).',
    userExists: (handle: string) => `User ${handle} existiert bereits`,
    userLacksKey: (handle: string) => `User ${handle} hat diesen Key nicht`,
    adminCannotBeRemoved: (handle: string) => `${handle} ist Admin und kann nicht entfernt werden`,
    adminCannotBeRemovedHint: 'Erst die Admin-Rolle in der Config entziehen.',
    bodyChanged: (label: string) => `${label}: Body wurde inzwischen geändert`,
  },
});
