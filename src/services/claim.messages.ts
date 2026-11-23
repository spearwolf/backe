import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    claimLocalNoRemote: 'Claim is local only: no remote',
    claimLocalManual: 'Claim is local only: sync.mode manual',
    takenMeanwhile: (id: string, assignee: string) =>
      `${id} was taken by ${assignee} in the meantime`,
    claimNotOnRemote: (id: string) => `Claim ${id} did not reach the remote`,
    claimLostFiveTimes: (ids: string) => `Claim lost five times: ${ids}`,
  },
  de: {
    claimLocalNoRemote: 'Claim nur lokal: kein Remote',
    claimLocalManual: 'Claim nur lokal: sync.mode manual',
    takenMeanwhile: (id: string, assignee: string) =>
      `${id} wurde inzwischen von ${assignee} übernommen`,
    claimNotOnRemote: (id: string) => `Claim ${id} ist nicht auf dem Remote angekommen`,
    claimLostFiveTimes: (ids: string) => `Claim fünfmal verloren: ${ids}`,
  },
});
