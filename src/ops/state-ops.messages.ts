import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    openChildrenNotice: (id: string, to: string, list: string) =>
      `${id} is ${to}, but still has open sub-issues: ${list}`,
    openChildren: (id: string, list: string) => `${id} still has open sub-issues: ${list}`,
    openChildrenHint: 'Close anyway with --force, or settle the sub-issues first.',
    forcedDone: (id: string, list: string) =>
      `${id} set to done with force, open sub-issues remain: ${list}`,
    occupied: (id: string, list: string) =>
      `${id} is under ${list}, which someone else is already working on`,
    waitingFor: (list: string) => `, waiting for ${list}`,
    notClaimable: (id: string, state: string, why: string) =>
      `${id} is not claimable (state ${state})${why}`,
  },
  de: {
    openChildrenNotice: (id: string, to: string, list: string) =>
      `${id} ist ${to}, hat aber noch offene Sub-Issues: ${list}`,
    openChildren: (id: string, list: string) => `${id} hat noch offene Sub-Issues: ${list}`,
    openChildrenHint: 'Mit --force trotzdem abschließen, oder erst die Sub-Issues erledigen.',
    forcedDone: (id: string, list: string) =>
      `${id} mit force auf done gesetzt, offene Sub-Issues bleiben: ${list}`,
    occupied: (id: string, list: string) =>
      `${id} liegt unter ${list}, das schon jemand anderes bearbeitet`,
    waitingFor: (list: string) => `, wartet auf ${list}`,
    notClaimable: (id: string, state: string, why: string) =>
      `${id} ist nicht claimbar (State ${state})${why}`,
  },
});
