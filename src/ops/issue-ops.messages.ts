import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    issueExists: (id: string) => `Issue ${id} already exists`,
    notSet: 'not set',
    fieldMismatch: (id: string, field: string, current: string, expected: string) =>
      `${id}: ${field} is ${current}, expected ${expected}`,
    blockedByOnlyWhenBlocked: (id: string, state: string) =>
      `${id}: blocked_by can only be changed in state 'blocked', state is '${state}'`,
    blockedNeedsBlocker: (id: string) => `${id}: a blocked issue needs at least one blocker`,
    resumeHint: (id: string) => `To lift the block: backe issue resume ${id}`,
    bodyChanged: (id: string) => `${id}: body has been changed in the meantime`,
  },
  de: {
    issueExists: (id: string) => `Issue ${id} existiert bereits`,
    notSet: 'nicht gesetzt',
    fieldMismatch: (id: string, field: string, current: string, expected: string) =>
      `${id}: ${field} ist ${current}, erwartet ${expected}`,
    blockedByOnlyWhenBlocked: (id: string, state: string) =>
      `${id}: blocked_by ist nur im State »blocked« änderbar, State ist »${state}«`,
    blockedNeedsBlocker: (id: string) =>
      `${id}: ein blockiertes Issue braucht mindestens einen Blocker`,
    resumeHint: (id: string) => `Zum Aufheben der Blockade: backe issue resume ${id}`,
    bodyChanged: (id: string) => `${id}: Body wurde inzwischen geändert`,
  },
});
