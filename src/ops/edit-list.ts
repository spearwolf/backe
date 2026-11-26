/**
 * Listenfelder eines Issues ändern (`projects`, `sprints`, `depends_on` …). Rein; `issue.edit`
 * und die optimistische Anzeige der Web-UI rechnen damit dasselbe, sonst gliche die Vorschau dem
 * Serverstand nie und jeder Listen-Write liefe in den Rückfall nach `PENDING_TIMEOUT_MS`.
 */

/** Erst entfernen, dann hinten anhängen, was fehlt; eine leere Liste entfällt. */
export function editList(
  current: readonly string[] | undefined,
  add: readonly string[] | undefined,
  remove: readonly string[] | undefined,
): string[] | undefined {
  const dropped = new Set(remove ?? []);
  const out = (current ?? []).filter((x) => !dropped.has(x));
  for (const x of add ?? []) if (!out.includes(x)) out.push(x);
  return out.length > 0 ? out : undefined;
}
