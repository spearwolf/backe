/**
 * Konstanten, die Tools und Web-Bundle teilen. Die Datei bleibt rein (keine Imports), damit sie
 * zur Web-Hülle gehören darf (ui.md §2.2).
 */

/** Größte Datei, deren Inhalt `attachment_get` als `text` mitliefert und die die UI inline zeigt. */
export const ATTACHMENT_TEXT_LIMIT = 262_144;
