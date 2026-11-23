import { catalog } from '../../i18n/catalog.ts';

export const m = catalog({
  en: {
    command: 'init [path]',
    description: 'Create a new backlog with a signed trust anchor',
    nameOption: 'Name of the backlog',
    prefixFlags: '--prefix <prefix>',
    prefixOption: 'Prefix of the issue IDs (2 to 6 lowercase letters)',
    remoteOption: 'Remote the anchor is pushed to',
    keyFlags: '--key <path>',
    keyOption: 'SSH signing key (default ~/.ssh/id_ed25519.pub)',
    userNameOption: 'Display name of the admin user',
    noSigningKey: 'No signing key given',
    noSigningKeyHint: (fallback: string) => `--key <path> or a key at '${fallback}'`,
  },
  de: {
    command: 'init [pfad]',
    description: 'neuen Backlog mit signiertem Vertrauensanker anlegen',
    nameOption: 'Name des Backlogs',
    prefixFlags: '--prefix <präfix>',
    prefixOption: 'Präfix der Issue-IDs (2 bis 6 Kleinbuchstaben)',
    remoteOption: 'Remote, auf die der Anker gepusht wird',
    keyFlags: '--key <pfad>',
    keyOption: 'SSH-Signing-Key (Default ~/.ssh/id_ed25519.pub)',
    userNameOption: 'Anzeigename des Admin-Users',
    noSigningKey: 'Kein Signing-Key angegeben',
    noSigningKeyHint: (fallback: string) => `--key <pfad> oder einen Key unter »${fallback}«`,
  },
});
