import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    projectNotFound: (path: string) => `Project '${path}' not found`,
    reassignAndDetachExclusive: `--reassign and --detach are mutually exclusive`,
  },
  de: {
    projectNotFound: (path: string) => `Projekt »${path}« nicht gefunden`,
    reassignAndDetachExclusive: `--reassign und --detach schließen sich aus`,
  },
});
