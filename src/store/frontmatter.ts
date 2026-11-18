/**
 * Frontmatter-Dateien der Entitäten: YAML-Subset lesen, kanonisch schreiben (backe.md §2.3).
 *
 * Lesen ist reine Syntax — die Schema-Prüfung macht `validateEntity`. Schreiben ist reine
 * Formatierung; ein kanonischer Roundtrip `parse → serialize` ist byte-identisch.
 */
import {
  Composer,
  type CST,
  Document,
  isMap,
  isScalar,
  isSeq,
  type Node,
  Pair,
  Parser,
  Scalar,
  type ToStringOptions,
  YAMLMap,
  YAMLSeq,
} from 'yaml';
import { BackeError } from '../core/errors.ts';
import { type EntityKind, KEY_ORDER } from '../core/schemas.ts';

const FENCE = '---';
const MAX_LINE = 100;

const STRINGIFY: ToStringOptions = {
  lineWidth: 0,
  flowCollectionPadding: false,
  indent: 2,
  indentSeq: true,
  doubleQuotedMinMultiLineLength: Number.POSITIVE_INFINITY,
};

/** CRLF → LF; auch `\r\r\n`, damit die Ausgabe ein Fixpunkt der Normalisierung beim Lesen ist. */
function toLf(s: string): string {
  return s.replace(/\r+\n/g, '\n');
}

// --- Lesen -------------------------------------------------------------------------------

/** CST-Token, die das Subset nicht kennt, und der Grund für die Ablehnung. */
const FORBIDDEN_TOKENS: Readonly<Record<string, string>> = {
  comment: 'Kommentare sind nicht erlaubt',
  anchor: 'Anker sind nicht erlaubt',
  alias: 'Aliase sind nicht erlaubt',
  tag: 'Tags sind nicht erlaubt',
  directive: 'Direktiven sind nicht erlaubt',
  'doc-start': 'mehrere Dokumente sind nicht erlaubt',
  'doc-end': 'mehrere Dokumente sind nicht erlaubt',
};

/**
 * Eine gelesene Entitätsdatei. `keys` sind die Top-Level-Keys in Dateireihenfolge — die
 * Reihenfolge von `Object.keys(data)` weicht davon ab, weil JS integer-artige Keys wie `"2"`
 * voranstellt.
 */
export type ParsedEntityFile = { data: Record<string, unknown>; keys: string[]; body: string };

export function parseEntityFile(text: string, file: string): ParsedEntityFile {
  const src = toLf(text.startsWith('\ufeff') ? text.slice(1) : text);
  if (!src.startsWith(`${FENCE}\n`)) {
    throw new BackeError('validation', `${file}:1: Frontmatter muss mit "---" in Zeile 1 beginnen`);
  }
  let pos = FENCE.length + 1;
  for (;;) {
    const nl = src.indexOf('\n', pos);
    const end = nl === -1 ? src.length : nl;
    if (src.slice(pos, end) === FENCE) {
      const { data, keys } = parseFrontmatter(src.slice(FENCE.length + 1, pos), file);
      return { data, keys, body: nl === -1 ? '' : src.slice(nl + 1) };
    }
    if (nl === -1) {
      throw new BackeError('validation', `${file}:1: Frontmatter ohne schließende "---"-Zeile`);
    }
    pos = nl + 1;
  }
}

/** Die Einträge `[key, Rohwert]` der Keys aus `wanted`, in Dateireihenfolge. */
export function entriesInFileOrder(
  parsed: Pick<ParsedEntityFile, 'data' | 'keys'>,
  wanted: Iterable<string>,
): [string, unknown][] {
  const set = new Set(wanted);
  return parsed.keys.filter((k) => set.has(k)).map((k) => [k, parsed.data[k]]);
}

function parseFrontmatter(
  yaml: string,
  file: string,
): { data: Record<string, unknown>; keys: string[] } {
  // Zeile 1 der Datei ist die öffnende "---"-Zeile, das Frontmatter beginnt in Zeile 2.
  const fail = (offset: number, reason: string): never => {
    const line = yaml.slice(0, offset).split('\n').length + 1;
    throw new BackeError('validation', `${file}:${line}: ${reason}`);
  };

  // Ein Parse-Durchgang: dieselben Token dienen dem CST-Scan und dem Composer.
  const tokens = [...new Parser().parse(yaml)];
  const forbidden = findForbiddenToken(tokens);
  if (forbidden) fail(forbidden.offset, forbidden.reason);

  const composer = new Composer({
    schema: 'core',
    version: '1.2',
    uniqueKeys: true,
    intAsBigInt: false,
    prettyErrors: false,
  });
  // forceDoc: auch ein leerer Text ergibt ein Dokument (mit `contents === null`).
  const doc = composer.compose(tokens, true, yaml.length).next().value as Document.Parsed;
  const [error] = doc.errors;
  if (error) fail(error.pos[0], `ungültiges YAML: ${error.message}`);

  const root = doc.contents;
  if (root === null) return { data: {}, keys: [] };
  if (!isMap(root)) return fail(offsetOf(root), 'Frontmatter muss eine Map sein');
  const data = toPlain(root, { yaml, fail }) as Record<string, unknown>;
  // toPlain hat bereits geprüft, dass jeder Key ein String-Skalar ist.
  const keys = root.items.map((pair) => (pair.key as Scalar<string>).value);
  return { data, keys };
}

/** Sucht im CST das erste Token, das das Subset verbietet, samt zweitem Dokument. */
function findForbiddenToken(
  tokens: readonly CST.Token[],
): { offset: number; reason: string } | undefined {
  const hits: { offset: number; reason: string }[] = [];
  const visit = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const item of x) visit(item);
      return;
    }
    if (typeof x !== 'object' || x === null) return;
    const { type, offset } = x as { type?: unknown; offset?: unknown };
    if (
      typeof type === 'string' &&
      typeof offset === 'number' &&
      Object.hasOwn(FORBIDDEN_TOKENS, type)
    ) {
      hits.push({ offset, reason: FORBIDDEN_TOKENS[type] as string });
    }
    for (const child of Object.values(x)) visit(child);
  };
  let documents = 0;
  for (const token of tokens) {
    if (token.type === 'document' && ++documents > 1) {
      hits.push({ offset: token.offset, reason: 'mehrere Dokumente sind nicht erlaubt' });
    }
    visit(token);
  }
  hits.sort((a, b) => a.offset - b.offset);
  return hits[0];
}

function offsetOf(node: unknown): number {
  return (node as { range?: [number, number, number] } | null)?.range?.[0] ?? 0;
}

/** Signifikante Ziffern eines Dezimal-Literals: ohne Vorzeichen, Punkt, Exponent und Randnullen. */
function significantDigits(literal: string): string {
  const mantissa = literal.replace(/^[-+]/, '').split(/e/i)[0] ?? '';
  return mantissa.replace('.', '').replace(/^0+/, '').replace(/0+$/, '') || '0';
}

/**
 * Liest die Zahl genau das, was in der Datei steht? Ganzzahl-Literale (dezimal, hex, oktal)
 * müssen sichere Ganzzahlen sein; Dezimalbrüche und Exponentenformen müssen dieselben
 * signifikanten Ziffern haben wie die kürzeste Darstellung der gelesenen Zahl. Umschreibungen,
 * die den Wert erhalten (`0x1f` → 31, `1.0` → 1), sind erlaubt.
 */
function isLosslessNumber(literal: string, value: number): boolean {
  if (/^[-+]?(?:[0-9]+|0x[0-9a-fA-F]+|0o[0-7]+)$/.test(literal)) return Number.isSafeInteger(value);
  if (!Number.isFinite(value)) return /^[-+]?\.(?:inf|Inf|INF|nan|NaN|NAN)$/.test(literal);
  return significantDigits(literal) === significantDigits(String(value));
}

type PlainContext = { yaml: string; fail: (offset: number, reason: string) => never };

function toPlain(node: unknown, ctx: PlainContext): unknown {
  const { fail } = ctx;
  if (isScalar(node)) {
    const v = node.value;
    if (typeof v === 'number' && node.range) {
      const literal = ctx.yaml.slice(node.range[0], node.range[1]);
      if (!isLosslessNumber(literal, v)) {
        return fail(
          node.range[0],
          `Zahl ${literal} ist nicht verlustfrei darstellbar; als String in Anführungszeichen schreiben ("${literal}")`,
        );
      }
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    return fail(offsetOf(node), 'leere Werte und null sind nicht erlaubt');
  }
  if (isSeq(node)) return node.items.map((item) => toPlain(item, ctx));
  if (isMap(node)) {
    const obj: Record<string, unknown> = {};
    for (const pair of node.items) {
      const key: unknown = pair.key;
      if (!isScalar(key) || typeof key.value !== 'string') {
        return fail(offsetOf(key ?? pair.value), 'Keys müssen Strings sein');
      }
      if (pair.value === null || (isScalar(pair.value) && pair.value.value === null)) {
        return fail(offsetOf(key), 'leere Werte und null sind nicht erlaubt');
      }
      // defineProperty statt Zuweisung: ein Key "__proto__" wird so ein gewöhnliches Feld.
      Object.defineProperty(obj, key.value, {
        value: toPlain(pair.value, ctx),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return obj;
  }
  /* v8 ignore next -- Aliase lehnt bereits der CST-Scan ab */
  return fail(offsetOf(node), 'nicht unterstützter YAML-Knoten');
}

// --- Schreiben ---------------------------------------------------------------------------

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function compareCodepoints(a: string, b: string): number {
  const ca = [...a];
  const cb = [...b];
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
    const d = (ca[i]?.codePointAt(0) ?? 0) - (cb[i]?.codePointAt(0) ?? 0);
    if (d !== 0) return d;
  }
  return ca.length - cb.length;
}

function entriesOf(obj: Plain, sorted: boolean): [string, unknown][] {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  return sorted ? entries.sort(([a], [b]) => compareCodepoints(a, b)) : entries;
}

function render(contents: Node): string {
  const doc = new Document(null, { schema: 'core', version: '1.2' });
  doc.contents = contents;
  return doc.toString(STRINGIFY);
}

function scalar(value: unknown): Scalar {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const node = new Scalar(value);
    // Eine Zeile nur aus Leerraum übersteht den Block-Stil nicht (der Parser liest sie als leer
    // oder als Einrückung): solche mehrzeiligen Strings stehen in doppelten Anführungszeichen.
    if (typeof value === 'string' && /(?:^|\n)[ \t]+(?=\n|$)/.test(value) && value.includes('\n')) {
      node.type = Scalar.QUOTE_DOUBLE;
    }
    // Ganzzahlen jenseits von Number.MAX_SAFE_INTEGER als Exponentenform, denn ein
    // Ganzzahl-Literal dieser Größe lehnt der Parser als nicht verlustfrei ab.
    if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
      node.format = 'EXP';
    }
    return node;
  }
  throw new BackeError('unexpected', `nicht serialisierbarer Wert: ${String(value)}`);
}

/** Baut einen Knoten, der vollständig im Flow-Stil steht. */
function flowNode(value: unknown, sorted: boolean): Node {
  if (Array.isArray(value)) {
    const seq = new YAMLSeq();
    seq.flow = true;
    for (const item of value) if (item !== undefined) seq.items.push(flowNode(item, sorted));
    return seq;
  }
  if (isPlainObject(value)) {
    const map = new YAMLMap();
    map.flow = true;
    for (const [k, v] of entriesOf(value, sorted))
      map.items.push(new Pair(new Scalar(k), flowNode(v, sorted)));
    return map;
  }
  return scalar(value);
}

/**
 * Passt `key: <flow>` (bzw. `- <flow>` ohne Key) in eine Zeile von höchstens 100 Zeichen,
 * gemessen ab Spalte `col`?
 */
function fitsOnLine(col: number, key: string | null, node: Node): boolean {
  let holder: Node;
  if (key === null) {
    const seq = new YAMLSeq();
    seq.items.push(node);
    holder = seq;
  } else {
    const map = new YAMLMap();
    map.items.push(new Pair(new Scalar(key), node));
    holder = map;
  }
  const line = render(holder).slice(0, -1);
  return !line.includes('\n') && col + [...line].length <= MAX_LINE;
}

/**
 * Knoten für einen Wert, dessen Zeile in Spalte `col` beginnt. Listen und Maps stehen als
 * Flow, wenn die Zeile ≤ 100 Zeichen bleibt, sonst als Block; Kinder eines Blocks beginnen
 * zwei Spalten weiter rechts. Listen, deren Elemente alle Maps sind, stehen immer als
 * Block-Sequenz mit je einer Flow-Map pro Element, außer die Flow-Map ginge über mehrere
 * Zeilen (mehrzeiliger String): dann steht das Element als Block-Map.
 */
function place(value: unknown, col: number, key: string | null, sorted: boolean): Node {
  if (Array.isArray(value)) {
    const items = value.filter((v) => v !== undefined);
    const seq = new YAMLSeq();
    if (items.length > 0 && items.every(isPlainObject)) {
      for (const item of items) {
        const flow = flowNode(item, sorted);
        // Ein Flow-Mapping kann keinen mehrzeiligen String tragen: dann steht das Element als Block-Map.
        seq.items.push(
          render(flow).trimEnd().includes('\n') ? blockMap(item as Plain, col + 4, sorted) : flow,
        );
      }
      return seq;
    }
    const flow = flowNode(items, sorted);
    if (fitsOnLine(col, key, flow)) return flow;
    for (const item of items) seq.items.push(place(item, col + 2, null, sorted));
    return seq;
  }
  if (isPlainObject(value)) {
    const flow = flowNode(value, sorted);
    if (fitsOnLine(col, key, flow)) return flow;
    return blockMap(value, col + 2, sorted);
  }
  return scalar(value);
}

function blockMap(obj: Plain, col: number, sorted: boolean): YAMLMap {
  const map = new YAMLMap();
  for (const [k, v] of entriesOf(obj, sorted))
    map.items.push(new Pair(new Scalar(k), place(v, col, k, sorted)));
  return map;
}

/** Prüft, dass `extra` weder bekannte Keys noch Keys aus `data` noch Duplikate enthält. */
function assertDistinctExtra(
  kind: EntityKind,
  data: Record<string, unknown>,
  extra: readonly (readonly [string, unknown])[],
): void {
  const seen = new Set<string>();
  for (const [key] of extra) {
    if (KEY_ORDER[kind].includes(key) || Object.hasOwn(data, key) || seen.has(key)) {
      throw new BackeError('unexpected', `extra-Key "${key}" kollidiert mit einem anderen Key`);
    }
    seen.add(key);
  }
}

/**
 * Schreibt eine Entitätsdatei kanonisch: bekannte Keys aus `data` in `KEY_ORDER`, dann
 * unbekannte Keys aus `data`, dann `extra` in der gegebenen Reihenfolge, zuletzt `props`.
 * `extra` trägt die unbekannten Top-Level-Keys einer gelesenen Datei (backe.md §2.3) und wird
 * wörtlich geschrieben; leere Listen entfallen dort nicht.
 */
export function serializeEntityFile(
  kind: EntityKind,
  data: Record<string, unknown>,
  body: string,
  extra: readonly (readonly [string, unknown])[] = [],
): string {
  assertDistinctExtra(kind, data, extra);
  const known = KEY_ORDER[kind].filter((k) => k !== 'props');
  const knownSet = new Set(known);
  type Entry = readonly [key: string, value: unknown, verbatim: boolean];
  const fromData = (k: string): Entry => [k, data[k], false];
  const entries: Entry[] = [
    ...known.filter((k) => Object.hasOwn(data, k)).map(fromData),
    ...Object.keys(data)
      .filter((k) => !knownSet.has(k) && k !== 'props')
      .map(fromData),
    ...extra.map(([k, v]): Entry => [k, v, true]),
    ...(Object.hasOwn(data, 'props') ? [fromData('props')] : []),
  ];

  const root = new YAMLMap();
  for (const [key, value, verbatim] of entries) {
    if (value === undefined) continue;
    if (!verbatim && Array.isArray(value) && value.length === 0) continue;
    let node: Node;
    if (key === 'props' && isPlainObject(value)) {
      if (entriesOf(value, false).length === 0) continue;
      node = blockMap(value, 2, true);
    } else {
      node = place(value, 0, key, false);
    }
    root.items.push(new Pair(new Scalar(key), node));
  }

  const yaml = root.items.length > 0 ? render(root) : '';
  return `${FENCE}\n${yaml}${FENCE}\n${canonicalBody(body)}`;
}

/**
 * Der Body, wie `serializeEntityFile` ihn schreibt und `parseEntityFile` ihn zurückliest: ein
 * nicht leerer Body endet auf `\n`, CRLF wird LF.
 */
export function canonicalBody(body: string): string {
  return toLf(body !== '' && !body.endsWith('\n') ? `${body}\n` : body);
}
