/**
 * Initialen für den Assignee auf der Karte (ui.md §2.8): aus dem Namen, sonst aus dem Handle.
 * Zwei Wörter geben je ihren ersten Buchstaben (erstes und letztes Wort), ein Wort seine ersten
 * zwei. Handles trennen Wörter mit `-`, `_` oder `.` (`claude-bot` → `CB`).
 */
export function initialsOf(handle: string, name?: string): string {
  const source = name?.trim() ? name : handle;
  const words = source.split(/[\s._-]+/).filter((word) => word !== '');
  const first = words[0] ?? '';
  const last = words[words.length - 1] ?? '';
  // Nach Codepoints, nicht nach UTF-16-Einheiten: Sonst zerfiele ein Zeichen außerhalb der BMP.
  const letters =
    words.length >= 2 ? [Array.from(first)[0], Array.from(last)[0]] : Array.from(first).slice(0, 2);
  return letters.join('').toUpperCase();
}
