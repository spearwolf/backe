/**
 * Findet Code-Zeilen mit deutschem Text, der in einen Katalog (`*.messages.ts`) gehört. Grenze:
 * Die Prüfung ist eine Heuristik je Zeile. Kommentare zählen nicht; deutsche Wörter ohne Umlaut
 * erkennt sie nur aus einer kurzen Liste häufiger Meldungswörter.
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

/** Treffer als `<file>:<zeile>: <zeile ohne Einrückung>`. */
export function findGermanLiterals(file: string, source: string): string[] {
  const hits: string[] = [];
  for (const [i, line] of stripComments(source).entries()) {
    if (UMLAUT_OR_QUOTE.test(line) || WORDS.test(line))
      hits.push(`${file}:${i + 1}: ${line.trim()}`);
  }
  return hits;
}
