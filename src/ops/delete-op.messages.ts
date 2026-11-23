import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    hasChildren: (id: string, list: string) => `${id} has sub-issues: ${list}`,
    hasChildrenHint:
      'With --orphan the sub-issues detach from the parent, with --recursive they are deleted too.',
    stillReferenced: (doomed: string, referencing: string) =>
      `${doomed} is still referenced by ${referencing}`,
    stillReferencedHint: 'With --force the references are removed.',
    lastBlockerDeleted: (id: string, ids: string) =>
      `${id}: last blocker deleted, set to on_hold: ${ids}`,
  },
  de: {
    hasChildren: (id: string, list: string) => `${id} hat Sub-Issues: ${list}`,
    hasChildrenHint:
      'Mit --orphan lösen sich die Sub-Issues vom Parent, mit --recursive werden sie mitgelöscht.',
    stillReferenced: (doomed: string, referencing: string) =>
      `${doomed} wird noch referenziert von ${referencing}`,
    stillReferencedHint: 'Mit --force werden die Verweise entfernt.',
    lastBlockerDeleted: (id: string, ids: string) =>
      `${id}: letzter Blocker gelöscht, auf on_hold gesetzt: ${ids}`,
  },
});
