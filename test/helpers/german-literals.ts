/**
 * Findet Code-Zeilen mit deutschem Text, der in einen Katalog (`*.messages.ts`) gehört. Grenze:
 * Die Prüfung ist eine Heuristik je Zeile. Kommentare zählen nicht. Deutsche Wörter ohne Umlaut
 * erkennt sie aus einer kurzen Liste häufiger Meldungswörter und, wenn der Aufrufer ein
 * Vokabular mitgibt (`germanVocabulary`), zusätzlich in Zeichenketten-Literalen.
 */
const UMLAUT_OR_QUOTE = /[äöüÄÖÜß»«]/;
const WORDS = new RegExp(
  `(?<![\\p{L}\\p{N}_$-])(?:${[
    'nicht',
    'fehlt',
    'kein',
    'keine',
    'keinen',
    'ungültig',
    'unbekannt',
    'unbekannte',
    'Datei',
    'Zeile',
    'gibt',
    'bereits',
    'ohne',
    'oder',
    'und',
    'der',
    'die',
    'das',
    'den',
    'dem',
    'des',
    'ein',
    'eine',
    'einen',
    'ist',
    'sind',
    'wird',
    'werden',
    'mit',
    'auf',
    'zu',
    'zum',
    'zur',
    'vom',
    'nach',
    'nur',
    'auch',
    'alle',
    'anzeigen',
    'anlegen',
    'entfernen',
    'setzen',
    'holen',
    'ausgeben',
    'starten',
    'prüfen',
    'Befehl',
    'Hilfe',
    'Liste',
    'angeben',
    'mindestens',
    'braucht',
    'erwartet',
    'erlaubt',
    'genau',
    'Genau',
    'eins',
    'zeigen',
    'ändern',
    'schreiben',
    'lesen',
  ].join('|')})(?![\\p{L}\\p{N}_$])`,
  'u',
);

/** Entfernt Block- und Zeilenkommentare; Zeilennummern bleiben erhalten. */
function stripComments(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) {
        out.push('');
        continue;
      }
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, '');
    const start = line.indexOf('/*');
    if (start !== -1) {
      line = line.slice(0, start);
      inBlock = true;
    }
    // `//` am Zeilenanfang oder nach Leerraum ist ein Kommentar; in `https://` nicht.
    out.push(line.replace(/(^|\s)\/\/.*$/, '$1'));
  }
  return out;
}

const LETTER_WORDS = /\p{L}{3,}/gu;
const STRING_LITERALS = /'[^']*'|`[^`]*`|"[^"]*"/g;

const wordsOf = (text: string): string[] => text.match(LETTER_WORDS) ?? [];

/** Alle Texte eines Katalogs; Funktionen werden mit leeren Argumenten aufgerufen. */
function textsOf(entries: Record<string, string | ((...args: never[]) => string)>): string[] {
  return Object.values(entries).map((entry) => {
    if (typeof entry === 'string') return entry;
    try {
      return String((entry as (...args: unknown[]) => string)('', '', ''));
    } catch {
      return entry.toString();
    }
  });
}

/**
 * Das deutsche Vokabular aus den Katalogen: alle Wörter (ab 3 Buchstaben, klein geschrieben),
 * die in einem `de`-Text vorkommen, aber in keinem `en`-Text.
 */
export function germanVocabulary(
  catalogs: readonly {
    en: Record<string, string | ((...args: never[]) => string)>;
    de: Record<string, string | ((...args: never[]) => string)>;
  }[],
): Set<string> {
  const lower = (texts: string[]) => texts.flatMap(wordsOf).map((w) => w.toLowerCase());
  const en = new Set(catalogs.flatMap((c) => lower(textsOf(c.en))));
  return new Set(catalogs.flatMap((c) => lower(textsOf(c.de))).filter((w) => !en.has(w)));
}

/** Treffer als `<file>:<zeile>: <zeile ohne Einrückung>`. */
export function findGermanLiterals(
  file: string,
  source: string,
  vocabulary: ReadonlySet<string> = new Set(),
): string[] {
  const hits: string[] = [];
  for (const [i, line] of stripComments(source).entries()) {
    const derived = (line.match(STRING_LITERALS) ?? []).some((literal) =>
      // Interpolationen sind Code (`${first?.basis}`), kein Text.
      wordsOf(literal.replace(/\$\{[^}]*\}/g, ' ')).some((w) => vocabulary.has(w.toLowerCase())),
    );
    if (UMLAUT_OR_QUOTE.test(line) || WORDS.test(line) || derived)
      hits.push(`${file}:${i + 1}: ${line.trim()}`);
  }
  return hits;
}
