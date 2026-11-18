/**
 * Frontmatter-Dateien der Entitäten: YAML-Subset lesen, kanonisch schreiben (backe.md §2.3).
 *
 * Lesen ist reine Syntax — die Schema-Prüfung macht `validateEntity`. Schreiben ist reine
 * Formatierung; ein kanonischer Roundtrip `parse → serialize` ist byte-identisch.
 */
import {
  Document,
  isMap,
  isScalar,
  isSeq,
  type Node,
  Pair,
  Parser,
  parseDocument,
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

export function parseEntityFile(
  text: string,
  file: string,
): { data: Record<string, unknown>; body: string } {
  const src = toLf(text.startsWith('﻿') ? text.slice(1) : text);
  if (!src.startsWith(`${FENCE}\n`)) {
    throw new BackeError('validation', `${file}:1: Frontmatter muss mit "---" in Zeile 1 beginnen`);
  }
  let pos = FENCE.length + 1;
  for (;;) {
    const nl = src.indexOf('\n', pos);
    const end = nl === -1 ? src.length : nl;
    if (src.slice(pos, end) === FENCE) {
      const data = parseFrontmatter(src.slice(FENCE.length + 1, pos), file);
      return { data, body: nl === -1 ? '' : src.slice(nl + 1) };
    }
    if (nl === -1) {
      throw new BackeError('validation', `${file}:1: Frontmatter ohne schließende "---"-Zeile`);
    }
    pos = nl + 1;
  }
}

function parseFrontmatter(yaml: string, file: string): Record<string, unknown> {
  // Zeile 1 der Datei ist die öffnende "---"-Zeile, das Frontmatter beginnt in Zeile 2.
  const fail = (offset: number, reason: string): never => {
    const line = yaml.slice(0, offset).split('\n').length + 1;
    throw new BackeError('validation', `${file}:${line}: ${reason}`);
  };

  const forbidden = findForbiddenToken(yaml);
  if (forbidden) fail(forbidden.offset, forbidden.reason);

  const doc = parseDocument(yaml, {
    schema: 'core',
    version: '1.2',
    uniqueKeys: true,
    intAsBigInt: false,
    prettyErrors: false,
  });
  const [error] = doc.errors;
  if (error) fail(error.pos[0], `ungültiges YAML: ${error.message}`);

  const root = doc.contents;
  if (root === null) return {};
  if (!isMap(root)) return fail(offsetOf(root), 'Frontmatter muss eine Map sein');
  return toPlain(root, { yaml, fail }) as Record<string, unknown>;
}

/** Sucht im CST das erste Token, das das Subset verbietet, samt zweitem Dokument. */
function findForbiddenToken(yaml: string): { offset: number; reason: string } | undefined {
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
  for (const token of new Parser().parse(yaml)) {
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
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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
 * Block-Sequenz mit je einer Flow-Map pro Element.
 */
function place(value: unknown, col: number, key: string | null, sorted: boolean): Node {
  if (Array.isArray(value)) {
    const items = value.filter((v) => v !== undefined);
    const seq = new YAMLSeq();
    if (items.length > 0 && items.every(isPlainObject)) {
      for (const item of items) seq.items.push(flowNode(item, sorted));
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

export function serializeEntityFile(
  kind: EntityKind,
  data: Record<string, unknown>,
  body: string,
): string {
  const known = KEY_ORDER[kind].filter((k) => k !== 'props');
  const knownSet = new Set(known);
  const keys = [
    ...known.filter((k) => Object.hasOwn(data, k)),
    ...Object.keys(data).filter((k) => !knownSet.has(k) && k !== 'props'),
    ...(Object.hasOwn(data, 'props') ? ['props'] : []),
  ];

  const root = new YAMLMap();
  for (const key of keys) {
    const value = data[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
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
  let text = body;
  if (text !== '' && !text.endsWith('\n')) text += '\n';
  return `${FENCE}\n${yaml}${FENCE}\n${toLf(text)}`;
}
