import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    keyTaken: (fingerprint: string, other: string) =>
      `Key ${fingerprint} already belongs to ${other}`,
    keyTakenHint: 'Every key belongs to exactly one user.',
    revokeOnlyOwn: (fingerprint: string) => `Only own keys can be revoked: ${fingerprint}`,
    revokeOnlyOwnHint:
      'A key is revoked by the user it belongs to, or by an admin on their behalf.',
    revocationFinal: (fingerprint: string) => `The revocation of ${fingerprint} is final`,
    revocationFinalHint: 'Reassigning a revoked key is not possible; create a new key.',
    operatorStaysHuman: (handle: string, agents: string) =>
      `${handle} is operator of ${agents}; an operator stays human`,
    operatorOf: (handle: string, agents: string) => `${handle} is operator of ${agents}`,
    removeAgentsHint: 'Remove the agents first or change their operator.',
    operatorNotFound: (operator: string) => `Operator ${operator} not found`,
    operatorNotHuman: (operator: string) => `Operator ${operator} is not a human`,
    operatorNotHumanHint: 'An agent has a responsible human as operator.',
    mayNotChangeUser: (actor: string, handle: string) => `${actor} may not change user ${handle}`,
    mayNotChangeUserHint:
      'The user may be changed by themselves, for an agent by its operator, and by admins.',
    mayNotChangeKind: (actor: string, handle: string) =>
      `${actor} may not change the kind of ${handle}`,
    mayNotChangeKindHint: 'Only admins change the kind (human/agent).',
    mayNotChangeOperator: (actor: string, handle: string) =>
      `${actor} may not change the operator of ${handle}`,
    mayNotChangeOperatorHint: 'Only admins change the operator.',
    mayNotRecreate: (actor: string, handle: string) => `${actor} may not recreate user ${handle}`,
    mayNotRecreateHint: (handle: string) =>
      `${handle} was removed earlier; only an admin may recreate them.`,
    mayNotCreate: (actor: string, handle: string) => `${actor} may not create user ${handle}`,
    mayNotCreateAdminHint: (handle: string) =>
      `${handle} is listed as an admin; only an admin may create them.`,
    mayNotCreateOperatorHint: (handle: string, agents: string) =>
      `${handle} is listed as operator of ${agents}; only an admin may create them.`,
    mayNotCreateHint:
      'Users may create only their own agents (operator = themselves); humans create admins.',
    mayNotRemove: (actor: string, handle: string) => `${actor} may not remove user ${handle}`,
    mayNotRemoveHint: 'Only admins remove users.',
  },
  de: {
    keyTaken: (fingerprint: string, other: string) => `Key ${fingerprint} gehört schon ${other}`,
    keyTakenHint: 'Jeder Key gehört genau einem User.',
    revokeOnlyOwn: (fingerprint: string) => `Widerrufen werden nur eigene Keys: ${fingerprint}`,
    revokeOnlyOwnHint: 'Einen Key widerruft der User, dem er gehört, oder ein Admin für ihn.',
    revocationFinal: (fingerprint: string) => `Der Widerruf von ${fingerprint} ist endgültig`,
    revocationFinalHint:
      'Einen widerrufenen Key neu zu vergeben ist nicht möglich; einen neuen Key anlegen.',
    operatorStaysHuman: (handle: string, agents: string) =>
      `${handle} ist Operator von ${agents}; ein Operator bleibt Mensch`,
    operatorOf: (handle: string, agents: string) => `${handle} ist Operator von ${agents}`,
    removeAgentsHint: 'Erst die Agents entfernen oder ihren Operator ändern.',
    operatorNotFound: (operator: string) => `Operator ${operator} nicht gefunden`,
    operatorNotHuman: (operator: string) => `Operator ${operator} ist kein Mensch`,
    operatorNotHumanHint: 'Ein Agent hat einen verantwortlichen Menschen als operator.',
    mayNotChangeUser: (actor: string, handle: string) =>
      `${actor} darf den User ${handle} nicht ändern`,
    mayNotChangeUserHint:
      'Ändern dürfen den User er selbst, bei einem Agent sein Operator und Admins.',
    mayNotChangeKind: (actor: string, handle: string) =>
      `${actor} darf die Art von ${handle} nicht ändern`,
    mayNotChangeKindHint: 'Die Art (human/agent) ändern nur Admins.',
    mayNotChangeOperator: (actor: string, handle: string) =>
      `${actor} darf den Operator von ${handle} nicht ändern`,
    mayNotChangeOperatorHint: 'Den Operator ändern nur Admins.',
    mayNotRecreate: (actor: string, handle: string) =>
      `${actor} darf den User ${handle} nicht neu anlegen`,
    mayNotRecreateHint: (handle: string) =>
      `${handle} wurde früher entfernt; neu anlegen darf ihn nur ein Admin.`,
    mayNotCreate: (actor: string, handle: string) =>
      `${actor} darf den User ${handle} nicht anlegen`,
    mayNotCreateAdminHint: (handle: string) =>
      `${handle} ist als Admin eingetragen; anlegen darf ihn nur ein Admin.`,
    mayNotCreateOperatorHint: (handle: string, agents: string) =>
      `${handle} ist als Operator von ${agents} eingetragen; anlegen darf ihn nur ein Admin.`,
    mayNotCreateHint:
      'Anlegen dürfen Nutzer nur eigene Agents (operator = sie selbst); Menschen legen Admins an.',
    mayNotRemove: (actor: string, handle: string) =>
      `${actor} darf den User ${handle} nicht entfernen`,
    mayNotRemoveHint: 'Nur Admins entfernen User.',
  },
});
