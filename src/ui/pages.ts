/** Kleine HTML-Seiten des Servers für Fälle ohne App: ohne Skript, Stil inline (CSP erlaubt das). */
import { locale } from '../i18n/locale.ts';
import { m } from './pages.messages.ts';

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);
}

const STYLE =
  'body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#222;background:#fafafa}' +
  '@media (prefers-color-scheme:dark){body{color:#ddd;background:#181818}}';

/** Vollständiges HTML-Dokument mit Überschrift `title` und einem Absatz `text`, beides escaped. */
export function page(title: string, text: string): string {
  const t = escapeHtml(title);
  // `lang` ohne Anführungszeichen: `en`/`de` brauchen keine, und eine Interpolation in geraden
  // Anführungszeichen meldet der Konventions-Test als falsch zitierten Wert.
  return (
    `<!doctype html><html lang=${locale()}><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${t}</title><style>${STYLE}</style></head>` +
    `<body><h1>${t}</h1><p>${escapeHtml(text)}</p></body></html>`
  );
}

/** Steht unter jedem Nicht-API-Pfad, solange das Frontend nicht gebaut ist. */
export function placeholderPage(): string {
  return page('backe ui', m.placeholderText);
}

/** Antwort auf eine Seitenanfrage ohne gültige Sitzung (401). */
export function noSessionPage(): string {
  return page(m.noSessionTitle, m.noSessionText);
}

/** Antwort auf eine Seitenanfrage mit fremdem Host oder Origin (403). */
export function forbiddenPage(message: string): string {
  return page(m.forbiddenTitle, message);
}
