/** Commit-Autor eines Handles; die Adresse ist absichtlich nicht zustellbar. */
export function authorOf(handle: string, name: string): { name: string; email: string } {
  return { name, email: `${handle}@backe.invalid` };
}

/** `YYYY-MM-DDTHH:MM:SSZ` (UTC, ohne Millisekunden). */
export function isoNow(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}
