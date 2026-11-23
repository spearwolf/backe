import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    notEditable: (path: string) =>
      `${path} cannot be resolved in the editor; stays as on the remote`,
    conflictMarkers: (path: string) => `${path} still has conflict markers`,
    noEditor: 'No editor available (BACKE_EDITOR, VISUAL or EDITOR)',
    textConflict: (sha: string, subject: string, paths: string) =>
      `Text conflict in manual commit ${sha} (${subject}): ${paths}`,
    choose: '[e]dit, take [l]ocal, keep [r]emote, [a]bort? ',
  },
  de: {
    notEditable: (path: string) => `${path} lässt sich nicht im Editor lösen; bleibt wie im Remote`,
    conflictMarkers: (path: string) => `${path} hat noch Konfliktmarker`,
    noEditor: 'Kein Editor verfügbar (BACKE_EDITOR, VISUAL oder EDITOR)',
    textConflict: (sha: string, subject: string, paths: string) =>
      `Textkonflikt in manual-Commit ${sha} (${subject}): ${paths}`,
    choose: '[e]ditieren, [l]okal nehmen, [r]emote behalten, [a]bbrechen? ',
  },
});
