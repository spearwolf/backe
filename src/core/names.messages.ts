import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    invalidRepoName: (name: string) => `Invalid repo name: '${name}'`,
    invalidRepoNameHint:
      "Use a-z, 0-9, '.', '_' and '-', starting with a letter or digit (max. 64 characters)",
    invalidRef: (ref: string) => `Invalid ref '${ref}'`,
    invalidRefHint:
      'Form: <repo>@<ref>, e.g. webapp@main. The ref follows git check-ref-format: not empty, no leading "-", no whitespace or control characters, and none of ~ ^ : ? * [ \\ nor ".." and "@{".',
  },
  de: {
    invalidRepoName: (name: string) => `Ungültiger Repo-Name: »${name}«`,
    invalidRepoNameHint:
      'Erlaubt sind a-z, 0-9, ".", "_" und "-", beginnend mit Buchstabe oder Ziffer (max. 64 Zeichen).',
    invalidRef: (ref: string) => `Ungültiger Ref »${ref}«`,
    invalidRefHint:
      'Form: <repo>@<ref>, z. B. webapp@main. Der Ref folgt git check-ref-format: nicht leer, ohne führendes "-", ohne Leer- und Steuerzeichen und ohne ~ ^ : ? * [ \\ sowie ".." und "@{".',
  },
});
