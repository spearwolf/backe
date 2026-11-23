import { catalog } from '../../i18n/catalog.ts';

export const m = catalog({
  en: {
    description: 'Read, set and edit the user config',
    getDescription: 'Print a value or the whole config',
    setCommand: 'set <key> [value]',
    setDescription: 'Set a value; --unset removes the key',
    unsetOption: 'Remove the key',
    valueAndUnsetExclusive: 'A value and --unset are mutually exclusive',
    valueMissing: 'Value is missing',
    valueMissingHint: 'config set <key> <value>',
    editDescription: 'Edit the config in an editor',
    noEditor: 'No editor available',
    noEditorHint: 'Set BACKE_EDITOR',
    unchanged: 'unchanged',
  },
  de: {
    description: 'User-Config lesen, setzen und bearbeiten',
    getDescription: 'Wert oder die ganze Config ausgeben',
    setCommand: 'set <key> [wert]',
    setDescription: 'Wert setzen; --unset entfernt den Key',
    unsetOption: 'Key entfernen',
    valueAndUnsetExclusive: 'Wert und --unset schließen sich aus',
    valueMissing: 'Wert fehlt',
    valueMissingHint: 'config set <key> <wert>',
    editDescription: 'Config im Editor bearbeiten',
    noEditor: 'Kein Editor verfügbar',
    noEditorHint: 'BACKE_EDITOR setzen',
    unchanged: 'unverändert',
  },
});
