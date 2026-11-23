import { catalog } from '../../i18n/catalog.ts';

export const m = catalog({
  en: {
    description: 'Users and their keys',
    none: 'none',
    yes: 'yes',
    no: 'no',
    addDescription: 'Register a user with an existing public key',
    keyOption: 'File with the SSH public key (ssh-ed25519)',
    nameOption: 'Display name (default: handle)',
    agentOption: 'Register as an agent',
    operatorOption: 'Human responsible for an agent (default: me)',
    createAgentDescription:
      'Create an agent with its own keypair and register it as an identity; prints the key path',
    listDescription: 'Users with kind, admin role and operator',
    showDescription: 'User with active and revoked keys',
    revokedKey: (fingerprint: string, revoked: string) => `${fingerprint} (revoked ${revoked})`,
    revokeDescription:
      'Revoke an active key (fingerprint or unambiguous prefix of at least 8 characters)',
    rmDescription: 'Remove a user (not admins)',
  },
  de: {
    description: 'Users und ihre Keys',
    none: 'keine',
    yes: 'ja',
    no: 'nein',
    addDescription: 'User mit vorhandenem Public Key registrieren',
    keyOption: 'Datei mit dem SSH-Public-Key (ssh-ed25519)',
    nameOption: 'Anzeigename (Default: Handle)',
    agentOption: 'als Agent registrieren',
    operatorOption: 'verantwortlicher Mensch eines Agents (Default: ich)',
    createAgentDescription:
      'Agent mit eigenem Keypair anlegen und als Identität eintragen; druckt den Key-Pfad',
    listDescription: 'Users mit Art, Admin-Rolle und Operator',
    showDescription: 'User mit aktiven und widerrufenen Keys',
    revokedKey: (fingerprint: string, revoked: string) => `${fingerprint} (widerrufen ${revoked})`,
    revokeDescription: 'aktiven Key widerrufen (Fingerprint oder eindeutiger Präfix ab 8 Zeichen)',
    rmDescription: 'User entfernen (Admins nicht)',
  },
});
