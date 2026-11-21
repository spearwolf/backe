/**
 * Vergleich nach UTF-16-Code-Units (wie der Standard-`sort()` und der kanonische Dateiaufbau,
 * backe.md §2.3) — unabhängig von Locale und ICU.
 */
export function compareCodeUnits<T extends string | number>(a: T, b: T): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
