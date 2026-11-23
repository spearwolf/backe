import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    idPathMismatch: (path: string, id: string, expected: string) =>
      `${path}: id ${id} does not match the path (${expected})`,
    creatorMismatch: (path: string, creator: string, actor: string) =>
      `${path}: creator is ${creator}, ${actor} wants to commit`,
    creatorHint: 'A new issue belongs to whoever creates it; set creator to your own handle.',
    changeStateHint: (id: string) =>
      `Change the state with backe issue move, resume or reopen (${id}).`,
    pausedFromMismatch: (from: string, to: string, expected: string) =>
      `paused_from/blocked_by do not match the transition ${from} -> ${to} (expected paused_from ${expected})`,
    notSet: 'not set',
    fieldImmutable: (path: string, field: string, from: string, to: string) =>
      `${path}: ${field} cannot be changed (${from} -> ${to})`,
    pausedFromOnlyWithState: (path: string) =>
      `${path}: paused_from changes only together with the state`,
    pausedFromHint: (id: string) => `backe issue move ${id} or backe issue resume ${id}`,
    commentNotOwn: (path: string, actor: string) => `${path}: a new comment must be by ${actor}`,
    commentCreatedMismatch: (path: string, created: string) =>
      `${path}: created ${created} does not match the name`,
    transitionCommentOnlyWithTransition: (path: string) =>
      `${path}: transition comments only come into being with the transition`,
    transitionCommentHint:
      'Change the state with backe issue move; a reason becomes the comment in the process.',
    newIssuesCycle: (list: string) => `New issues reference each other in a cycle: ${list}`,
    newIssuesCycleHint: 'Commit some of the issues first, then add the references.',
    pathRepeated: (path: string) => `${path} appears more than once in the manual edits`,
    notIssueDirectory: (path: string) => `${path}: not a valid issue directory`,
    issueBelongsTo: (path: string, expected: string) => `${path}: issue belongs in ${expected}`,
    labelComment: 'comment',
    labelAttachment: 'attachment',
    lostWithDeletedIssue: (path: string, label: string, id: string) =>
      `${path}: ${label} under ${id}, which is deleted in the same edit, would be lost`,
    lostHint: (label: string, id: string) => `Discard the ${label} or do not delete ${id}.`,
  },
  de: {
    idPathMismatch: (path: string, id: string, expected: string) =>
      `${path}: id ${id} passt nicht zum Pfad (${expected})`,
    creatorMismatch: (path: string, creator: string, actor: string) =>
      `${path}: creator ist ${creator}, committen will ${actor}`,
    creatorHint:
      'Ein neues Issue gehört dem, der es anlegt; creator auf den eigenen Handle setzen.',
    changeStateHint: (id: string) =>
      `Den Zustand mit backe issue move, resume oder reopen ändern (${id}).`,
    pausedFromMismatch: (from: string, to: string, expected: string) =>
      `paused_from/blocked_by passen nicht zum Übergang ${from} -> ${to} (erwartet paused_from ${expected})`,
    notSet: 'nicht gesetzt',
    fieldImmutable: (path: string, field: string, from: string, to: string) =>
      `${path}: ${field} ist nicht änderbar (${from} -> ${to})`,
    pausedFromOnlyWithState: (path: string) =>
      `${path}: paused_from ändert sich nur mit dem Zustand`,
    pausedFromHint: (id: string) => `backe issue move ${id} oder backe issue resume ${id}`,
    commentNotOwn: (path: string, actor: string) =>
      `${path}: ein neuer Kommentar muss von ${actor} sein`,
    commentCreatedMismatch: (path: string, created: string) =>
      `${path}: created ${created} passt nicht zum Namen`,
    transitionCommentOnlyWithTransition: (path: string) =>
      `${path}: Transition-Kommentare entstehen nur mit dem Übergang`,
    transitionCommentHint:
      'Den Zustand mit backe issue move ändern; ein Grund wird dabei zum Kommentar.',
    newIssuesCycle: (list: string) => `Neue Issues verweisen zyklisch aufeinander: ${list}`,
    newIssuesCycleHint: 'Erst einen Teil der Issues committen, dann die Verweise ergänzen.',
    pathRepeated: (path: string) => `${path} steht mehrfach in den Hand-Edits`,
    notIssueDirectory: (path: string) => `${path}: kein gültiges Issue-Verzeichnis`,
    issueBelongsTo: (path: string, expected: string) => `${path}: Issue gehört nach ${expected}`,
    labelComment: 'Kommentar',
    labelAttachment: 'Anhang',
    lostWithDeletedIssue: (path: string, label: string, id: string) =>
      `${path}: ${label} unter ${id}, das im selben Edit gelöscht wird, ginge verloren`,
    lostHint: (label: string, id: string) => `Den ${label} verwerfen oder ${id} nicht löschen.`,
  },
});
