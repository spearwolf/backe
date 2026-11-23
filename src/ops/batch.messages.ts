import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    lineError: (line: number, message: string) => `line ${line}: ${message}`,
    emptyLine: 'empty line between operations',
    emptyBatch: 'The batch contains no operation',
    batchTooLarge: (max: number) => `A batch holds at most ${max} operations`,
    batchTooLargeHint: (count: number) => `Split ${count} operations into several batches.`,
    placeholderTaken: (ref: string) => `Placeholder ${ref} is already taken`,
  },
  de: {
    lineError: (line: number, message: string) => `Zeile ${line}: ${message}`,
    emptyLine: 'leere Zeile zwischen Operationen',
    emptyBatch: 'Der Batch enthält keine Operation',
    batchTooLarge: (max: number) => `Ein Batch umfasst höchstens ${max} Operationen`,
    batchTooLargeHint: (count: number) => `${count} Operationen auf mehrere Batches verteilen.`,
    placeholderTaken: (ref: string) => `Platzhalter ${ref} ist schon vergeben`,
  },
});
