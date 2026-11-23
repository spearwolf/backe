import { m } from './node-version.messages.ts';

/**
 * Prüft die Node-Version beim Start. `engines` ist bei `npm i -g` nicht bindend,
 * ohne diese Prüfung scheitert ein zu altes Node später mit kryptischem Fehler.
 * Gibt die Fehlermeldung zurück, `undefined` wenn die Version reicht.
 */
export function checkNodeVersion(version: string, min = 26): string | undefined {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  if (Number.isFinite(major) && major >= min) return undefined;
  return m.nodeTooOld(min, version);
}
