/**
 * Einziger Zugang zum `localStorage`. Jeder Zugriff kann werfen (gesperrter Speicher, volles
 * Kontingent, fehlendes `localStorage`); dann gilt still der Default, Schreiben entfällt.
 */

/** Liest JSON unter `key`; fehlend, kaputt oder vom `guard` abgelehnt ergibt `fallback`. */
export function readJson<T>(key: string, fallback: T, guard: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return guard(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Der Ansichtszustand ist eine Bequemlichkeit; ohne Speicher geht er eben verloren.
  }
}

export function readText(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeText(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // wie `writeJson`
  }
}
