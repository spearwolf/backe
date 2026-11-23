import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    propertyRepeated: (key: string) => `Property '${key}' given more than once`,
    nothingToChange: 'Nothing to change',
    propertySetAndUnset: (key: string) => `Property '${key}' set and unset at the same time`,
    valueInAddAndRemove: (value: string, field: string) =>
      `'${value}' is in both add… and rm… (${field})`,
    notExpressibleAsOperation: 'This change cannot be expressed as an operation',
    editFileDirectly: 'edit the file directly and run backe commit',
    issueNotFound: (id: string) => `Issue '${id}' not found`,
    reasonEmpty: 'Reason is empty',
    invalidRef: (tail: string) => `Invalid ref '${tail}'`,
  },
  de: {
    propertyRepeated: (key: string) => `Property »${key}« mehrfach angegeben`,
    nothingToChange: 'Nichts zu ändern',
    propertySetAndUnset: (key: string) => `Property »${key}« gleichzeitig setzen und entfernen`,
    valueInAddAndRemove: (value: string, field: string) =>
      `»${value}« steht in add… und rm… (${field})`,
    notExpressibleAsOperation: 'Diese Änderung lässt sich nicht als Operation ausdrücken',
    editFileDirectly: 'Datei direkt bearbeiten und backe commit',
    issueNotFound: (id: string) => `Issue »${id}« nicht gefunden`,
    reasonEmpty: 'Begründung ist leer',
    invalidRef: (tail: string) => `Ungültiger Ref »${tail}«`,
  },
});
