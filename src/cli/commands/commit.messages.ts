import { catalog } from '../../i18n/catalog.ts';

export const m = catalog({
  en: {
    description: 'Commit manual edits of the working copy',
    messageOption: 'Subject for changes without a matching operation',
    resignOption: 'Translate and re-sign foreign local commits (such as git commit)',
    resignExcludesMessage: '--resign cannot be combined with -m',
    nothingToResign: 'Nothing to re-sign',
    nothingToCommit: 'Nothing to commit',
    rewriteNotice: (reason: 'canonical' | 'no_effect'): string =>
      reason === 'canonical' ? 'rewritten canonically' : 'no effective change',
  },
  de: {
    description: 'Hand-Edits der Arbeitskopie committen',
    messageOption: 'Betreff für Änderungen ohne Operations-Entsprechung',
    resignOption: 'fremde lokale Commits (etwa git commit) übersetzen und neu signieren',
    resignExcludesMessage: '--resign passt nicht zu -m',
    nothingToResign: 'Nichts neu zu signieren',
    nothingToCommit: 'Nichts zu committen',
    rewriteNotice: (reason: 'canonical' | 'no_effect'): string =>
      reason === 'canonical' ? 'kanonisch umgeschrieben' : 'keine wirksame Änderung',
  },
});
