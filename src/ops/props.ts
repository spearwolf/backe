/**
 * Custom Properties (backe.md §2.24): Typprüfung gegen die Deklarationen aus `backlog.jsonc`,
 * Zuweisungs- und Filter-Syntax der CLI (`k=v`, `k:=<json>`, `k>=v`) und Filterauswertung.
 */
import { BackeError } from '../core/errors.ts';
import { PROP_KEY_RE } from '../core/names.ts';
import type { BacklogConfig, PropValue } from '../core/schemas.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';

type PropDeclaration = NonNullable<BacklogConfig['props']>[string];

function declarationOf(config: BacklogConfig, key: string): PropDeclaration | undefined {
  const declared = config.props;
  return declared !== undefined && Object.hasOwn(declared, key) ? declared[key] : undefined;
}

function fitsDeclaration(decl: PropDeclaration, value: PropValue): boolean {
  switch (decl.type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && (decl.values ?? []).includes(value);
    case 'json':
      return true;
  }
}

function describeDeclaration(decl: PropDeclaration): string {
  return decl.type === 'enum' ? `enum (${(decl.values ?? []).join(', ')})` : decl.type;
}

function violationMessage(
  config: BacklogConfig,
  key: string,
  value: PropValue,
): string | undefined {
  const decl = declarationOf(config, key);
  if (decl === undefined) {
    return config.props_strict
      ? `Property »${key}« ist nicht deklariert (props_strict ist aktiv)`
      : undefined;
  }
  return fitsDeclaration(decl, value)
    ? undefined
    : `Property »${key}« erwartet ${describeDeclaration(decl)}, bekam ${JSON.stringify(value)}`;
}

/** Prüft nur die übergebenen Keys; `null` heißt »entfernt« und ist immer erlaubt. */
export function checkProps(
  config: BacklogConfig,
  touched: Readonly<Record<string, PropValue | null>>,
): void {
  for (const [key, value] of Object.entries(touched)) {
    if (value === null) continue;
    const message = violationMessage(config, key, value);
    if (message !== undefined)
      throw new BackeError('validation', message, { details: { reason: 'prop', key } });
  }
}

// --- JSON-Werte ----------------------------------------------------------------------------

/** Erster Verstoß gegen »gültiger PropValue« im geparsten JSON, iterativ über alle Tiefen. */
function jsonProblem(root: unknown): string | undefined {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || v === undefined) return 'null ist kein gültiger Wert';
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return 'nur endliche Zahlen sind erlaubt';
      if (Object.is(v, -0)) return '-0 ist nicht erlaubt';
    } else if (Array.isArray(v)) {
      stack.push(...v);
    } else if (typeof v === 'object') {
      // `JSON.parse` legt `__proto__` als eigenen Key an, `Object.keys` sieht ihn.
      for (const k of Object.keys(v)) {
        if (k === '__proto__') return '"__proto__" ist als Key nicht erlaubt';
        stack.push((v as Record<string, unknown>)[k]);
      }
    }
  }
  return undefined;
}

function parseJsonValue(key: string, text: string): PropValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackeError('usage', `Property »${key}«: ungültiges JSON: ${text}`);
  }
  const problem = jsonProblem(parsed);
  if (problem !== undefined) throw new BackeError('usage', `Property »${key}«: ${problem}`);
  return parsed as PropValue;
}

// --- Zuweisung und Filter ------------------------------------------------------------------

const EXPR_RE = /^([a-z][a-z0-9_.-]{0,63})(>=|<=|:=|=)(.*)$/s;

function splitExpr(expr: string): [key: string, op: string, rest: string] {
  const m = EXPR_RE.exec(expr);
  if (m === null || !PROP_KEY_RE.test(m[1] ?? '')) {
    throw new BackeError(
      'usage',
      `Ungültiger Property-Ausdruck »${expr}« (erwartet key=wert oder key:=<json>)`,
    );
  }
  return [m[1] as string, m[2] as string, m[3] as string];
}

/** `k=v` setzt einen String, `k:=<json>` einen getypten Wert. */
export function parsePropAssignment(expr: string): [key: string, value: PropValue] {
  const [key, op, rest] = splitExpr(expr);
  if (op === '=') return [key, rest];
  if (op === ':=') return [key, parseJsonValue(key, rest)];
  throw new BackeError('usage', `Property »${key}«: Zuweisung erwartet = oder :=, nicht ${op}`);
}

export type PropFilter =
  | { key: string; op: 'eq'; values: PropValue[]; structural: boolean }
  | { key: string; op: 'ge' | 'le'; value: string | number; raw: string }
  | { key: string; op: 'has' };

export function parsePropFilter(expr: string): PropFilter {
  const [key, op, rest] = splitExpr(expr);
  if (op === '=') return { key, op: 'eq', values: rest.split(','), structural: false };
  if (op === ':=') return { key, op: 'eq', values: [parseJsonValue(key, rest)], structural: true };
  const n = Number(rest);
  const value = rest.trim() !== '' && Number.isFinite(n) ? n : rest;
  return { key, op: op === '>=' ? 'ge' : 'le', value, raw: rest };
}

/** `>=`/`<=` gehen nur auf geordnete Enums, numerische Deklarationen und freie Keys mit Zahl. */
export function checkPropFilter(f: PropFilter, config: BacklogConfig): void {
  if (f.op !== 'ge' && f.op !== 'le') return;
  const symbol = f.op === 'ge' ? '>=' : '<=';
  const decl = declarationOf(config, f.key);
  const fail = (why: string): never => {
    throw new BackeError('usage', `Filter ${f.key}${symbol}${f.value}: ${why}`);
  };
  if (decl === undefined) {
    if (typeof f.value !== 'number') fail('der Vergleichswert muss eine Zahl sein');
  } else if (decl.type === 'enum') {
    if (decl.ordered !== true) fail('das Enum ist nicht geordnet (ordered: true fehlt)');
    if (!(decl.values ?? []).includes(f.raw))
      fail(`unbekannter Wert, erlaubt: ${(decl.values ?? []).join(', ')}`);
  } else if (decl.type === 'integer' || decl.type === 'number') {
    if (typeof f.value !== 'number') fail('der Vergleichswert muss eine Zahl sein');
  } else {
    fail(`Bereichsvergleich geht nicht auf type »${decl.type}«`);
  }
}

// --- Auswertung ----------------------------------------------------------------------------

/** Strukturgleichheit für JSON-Werte, iterativ; Key-Reihenfolge spielt keine Rolle. */
function structurallyEqual(a: PropValue, b: PropValue): boolean {
  const stack: [PropValue, PropValue][] = [[a, b]];
  for (let pair = stack.pop(); pair !== undefined; pair = stack.pop()) {
    const [x, y] = pair;
    if (x === y) continue;
    if (typeof x !== 'object' || typeof y !== 'object') return false;
    if (Array.isArray(x) !== Array.isArray(y)) return false;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) return false;
      x.forEach((item, i) => {
        stack.push([item, y[i] as PropValue]);
      });
    } else {
      const xs = x as { [key: string]: PropValue };
      const ys = y as { [key: string]: PropValue };
      const keys = Object.keys(xs);
      if (keys.length !== Object.keys(ys).length) return false;
      for (const k of keys) {
        if (!Object.hasOwn(ys, k)) return false;
        stack.push([xs[k] as PropValue, ys[k] as PropValue]);
      }
    }
  }
  return true;
}

/** `=`: Textvergleich (Strings exakt, sonst JSON-Text); `:=`: strukturell, ohne JSON-Text-Abkürzung. */
function eqMatches(actual: PropValue, wanted: PropValue, structural: boolean): boolean {
  if (structural) return structurallyEqual(actual, wanted);
  if (typeof wanted !== 'string') return false;
  return typeof actual === 'string' ? actual === wanted : JSON.stringify(actual) === wanted;
}

function rangeMatches(
  actual: PropValue,
  f: { op: 'ge' | 'le'; value: string | number; raw: string; key: string },
  config: BacklogConfig,
): boolean {
  const decl = declarationOf(config, f.key);
  if (decl?.type === 'enum' && decl.ordered === true) {
    const values = decl.values ?? [];
    const own = typeof actual === 'string' ? values.indexOf(actual) : -1;
    const limit = values.indexOf(f.raw);
    if (own < 0 || limit < 0) return false;
    // `values` steht vom höchsten zum niedrigsten Wert: höher heißt kleinerer Index.
    return f.op === 'ge' ? own <= limit : own >= limit;
  }
  if (typeof actual !== 'number' || typeof f.value !== 'number') return false;
  return f.op === 'ge' ? actual >= f.value : actual <= f.value;
}

export function propMatches(
  props: Readonly<Record<string, PropValue>> | undefined,
  f: PropFilter,
  config: BacklogConfig,
): boolean {
  if (props === undefined || !Object.hasOwn(props, f.key)) return false;
  const actual = props[f.key] as PropValue;
  if (f.op === 'has') return true;
  if (f.op === 'eq') return f.values.some((w) => eqMatches(actual, w, f.structural));
  return rangeMatches(actual, f, config);
}

/** Je (Issue, Key) ein Eintrag, dessen aktueller Wert die Deklaration verletzt; nach ID, dann Key. */
export function propViolations(s: BacklogSnapshot): { id: string; key: string; message: string }[] {
  const out: { id: string; key: string; message: string }[] = [];
  const ids = [...s.issues.keys()].sort();
  for (const id of ids) {
    const props = s.issues.get(id)?.data.props;
    if (props === undefined) continue;
    for (const key of Object.keys(props).sort()) {
      const message = violationMessage(s.config, key, props[key] as PropValue);
      if (message !== undefined) out.push({ id, key, message });
    }
  }
  return out;
}
