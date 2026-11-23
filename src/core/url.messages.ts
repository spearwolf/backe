import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    unrecognizedUrl: (input: string) => `Repo URL not recognized: '${input}'`,
    hint: 'Allowed: https://…, http://…, ssh://[user@]host[:port]/path, [user@]host:path, gh:owner/repo, absolute path (/…) or file:///…',
  },
  de: {
    unrecognizedUrl: (input: string) => `Repo-URL nicht erkannt: »${input}«`,
    hint: 'Erlaubt: https://…, http://…, ssh://[user@]host[:port]/pfad, [user@]host:pfad, gh:owner/repo, absoluter Pfad (/…) oder file:///…',
  },
});
