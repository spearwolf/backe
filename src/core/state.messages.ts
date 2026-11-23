import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    unknownState: (input: string) => `Unknown state: '${input}'`,
    unknownStateHint: (allowed: string) => `Allowed: ${allowed} (kebab-case works too)`,
    transitionNotAllowed: (from: string, to: string, why: string) =>
      `Transition ${from} -> ${to} not allowed: ${why}`,
    targetStateMissing: 'Target state missing (--to)',
    blockedByNeedsBlocked: 'blocked_by only together with the target blocked',
    leaveOnlyViaReopen: (from: string) => `${from} can only be left via reopen`,
    blockedNeedsId: 'blocked needs at least one ID in blocked_by',
    strictNeighbourOnly: 'strict allows only the direct neighbour',
    pausedFromMissing: 'paused_from missing',
    strictPausedFromOrNeighbour: (anchor: string) =>
      `strict allows only paused_from (${anchor}) or its neighbours`,
    claimImpossible: (state: string) => `claim from ${state} not possible`,
    resumeOnlyFromPaused: (state: string) => `resume only from blocked/on_hold, not from ${state}`,
    resumeWithoutPausedFrom: 'paused_from missing, resume not possible',
    reopenOnlyFromSettled: (state: string) =>
      `reopen only from done/cancelled/rejected, not from ${state}`,
    reopenTargetInvalid: (to: string) =>
      `reopen target must be a main-line state other than done, not ${to}`,
  },
  de: {
    unknownState: (input: string) => `Unbekannter State: »${input}«`,
    unknownStateHint: (allowed: string) => `Erlaubt: ${allowed} (auch kebab-case)`,
    transitionNotAllowed: (from: string, to: string, why: string) =>
      `Übergang ${from} -> ${to} nicht erlaubt: ${why}`,
    targetStateMissing: 'Zielzustand fehlt (--to)',
    blockedByNeedsBlocked: 'blocked_by nur zusammen mit dem Ziel blocked',
    leaveOnlyViaReopen: (from: string) => `${from} ist nur über reopen verlassbar`,
    blockedNeedsId: 'blocked braucht mindestens eine ID in blocked_by',
    strictNeighbourOnly: 'strict erlaubt nur den direkten Nachbarn',
    pausedFromMissing: 'paused_from fehlt',
    strictPausedFromOrNeighbour: (anchor: string) =>
      `strict erlaubt nur paused_from (${anchor}) oder dessen Nachbarn`,
    claimImpossible: (state: string) => `claim aus ${state} nicht möglich`,
    resumeOnlyFromPaused: (state: string) => `resume nur aus blocked/on_hold, nicht aus ${state}`,
    resumeWithoutPausedFrom: 'paused_from fehlt, resume nicht möglich',
    reopenOnlyFromSettled: (state: string) =>
      `reopen nur aus done/cancelled/rejected, nicht aus ${state}`,
    reopenTargetInvalid: (to: string) =>
      `reopen-Ziel muss ein Hauptlinien-Zustand außer done sein, nicht ${to}`,
  },
});
