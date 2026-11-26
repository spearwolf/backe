import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    bodyTooLarge: (limit: number) => `The request body is larger than ${limit} bytes`,
    bodyEndedEarly: 'The request body ended early',
    bodyNotJson: 'The request body is not valid JSON',
    bodyNotObject: 'The request body must be a JSON object',
    contentTypeRequired: (expected: string) => `Write requests need Content-Type ${expected}`,
    unknownTool: (name: string) => `Unknown tool '${name}'`,
    invalidArguments: (tool: string) => `Invalid arguments for '${tool}'`,
    uploadTooLarge: (name: string, max: number | null) =>
      `Attachment '${name}' is larger than the allowed ${max ?? 'configured'} bytes`,
  },
  de: {
    bodyTooLarge: (limit: number) => `Der Body der Anfrage ist größer als ${limit} Bytes`,
    bodyEndedEarly: 'Der Body der Anfrage endet vorzeitig',
    bodyNotJson: 'Der Body der Anfrage ist kein gültiges JSON',
    bodyNotObject: 'Der Body der Anfrage muss ein JSON-Objekt sein',
    contentTypeRequired: (expected: string) =>
      `Schreibende Anfragen brauchen Content-Type ${expected}`,
    unknownTool: (name: string) => `Unbekanntes Tool »${name}«`,
    invalidArguments: (tool: string) => `Ungültige Argumente für »${tool}«`,
    uploadTooLarge: (name: string, max: number | null) =>
      `Anhang »${name}« ist größer als die erlaubten ${max ?? 'konfigurierten'} Bytes`,
  },
});
