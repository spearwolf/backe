import { locale } from '@backe/i18n/locale.ts';

/** Zeitpunkt in der Locale der Oberfläche, etwa »18. Nov. 2026, 11:00«. */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

const UNITS = ['B', 'KiB', 'MiB'] as const;

/** Größe als `B`, `KiB` oder `MiB` (binär, eine Nachkommastelle), mit dem Dezimalzeichen der Locale. */
export function formatBytes(n: number): string {
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const number = new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(value);
  return `${number} ${UNITS[unit]}`;
}
