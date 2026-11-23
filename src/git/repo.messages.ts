import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    operationRunning: (wc: string, operation: string) => `A ${operation} is in progress in ${wc}`,
    detachedHead: (wc: string) => `${wc} is not on any branch (detached HEAD)`,
    wrongBranch: (wc: string, actual: string, expected: string) =>
      `${wc} is on ${actual}, expected ${expected}`,
    noCommitYet: (wc: string) => `${wc} has no commit yet`,
  },
  de: {
    operationRunning: (wc: string, operation: string) => `In ${wc} läuft ein ${operation}`,
    detachedHead: (wc: string) => `${wc} steht auf keinem Branch (detached HEAD)`,
    wrongBranch: (wc: string, actual: string, expected: string) =>
      `${wc} steht auf ${actual}, erwartet ${expected}`,
    noCommitYet: (wc: string) => `${wc} hat noch keinen Commit`,
  },
});
