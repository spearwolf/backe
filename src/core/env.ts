/** Umgebungsvariablen als reine Daten; nie `process.env` direkt, damit das Modul überall läuft. */
export type Env = Readonly<Record<string, string | undefined>>;

/** Wert einer Umgebungsvariable; ein leerer String zählt als nicht gesetzt. */
export function envValue(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}
