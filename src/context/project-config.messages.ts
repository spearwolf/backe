import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    userKeyHint: 'user belongs in .backlog.local.jsonc (backe.md §2.15.2)',
    userKeyInSharedConfig: (file: string) =>
      `${file}: user: not allowed in the shared project config`,
  },
  de: {
    userKeyHint: 'user gehört in .backlog.local.jsonc (backe.md §2.15.2).',
    userKeyInSharedConfig: (file: string) =>
      `${file}: user: in der geteilten Projekt-Config nicht erlaubt`,
  },
});
