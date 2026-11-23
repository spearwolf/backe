import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    undeclared: (key: string) => `Property '${key}' is not declared (props_strict is active)`,
    typeMismatch: (key: string, expected: string, got: string) =>
      `Property '${key}' expects ${expected}, got ${got}`,
    quoted: (value: string) => `'${value}'`,
    jsonNull: 'null is not a valid value',
    finiteOnly: 'only finite numbers are allowed',
    minusZero: '-0 is not allowed',
    protoKey: '"__proto__" is not allowed as a key',
    invalidJson: (key: string, text: string) => `Property '${key}': invalid JSON: ${text}`,
    propertyProblem: (key: string, problem: string) => `Property '${key}': ${problem}`,
    invalidExpression: (expr: string) =>
      `Invalid property expression '${expr}' (expected key=value or key:=<json>)`,
    assignmentOperator: (key: string, op: string) =>
      `Property '${key}': assignment expects = or :=, not ${op}`,
    filterError: (key: string, symbol: string, raw: string, why: string) =>
      `Filter ${key}${symbol}${raw}: ${why}`,
    comparisonNeedsNumber: 'the comparison value must be a number',
    enumNotOrdered: 'the enum is not ordered (ordered: true is missing)',
    unknownEnumValue: (allowed: string) => `unknown value, allowed: ${allowed}`,
    rangeNotForType: (type: string) => `range comparison does not work on type '${type}'`,
  },
  de: {
    undeclared: (key: string) => `Property »${key}« ist nicht deklariert (props_strict ist aktiv)`,
    typeMismatch: (key: string, expected: string, got: string) =>
      `Property »${key}« erwartet ${expected}, bekam ${got}`,
    quoted: (value: string) => `»${value}«`,
    jsonNull: 'null ist kein gültiger Wert',
    finiteOnly: 'nur endliche Zahlen sind erlaubt',
    minusZero: '-0 ist nicht erlaubt',
    protoKey: '"__proto__" ist als Key nicht erlaubt',
    invalidJson: (key: string, text: string) => `Property »${key}«: ungültiges JSON: ${text}`,
    propertyProblem: (key: string, problem: string) => `Property »${key}«: ${problem}`,
    invalidExpression: (expr: string) =>
      `Ungültiger Property-Ausdruck »${expr}« (erwartet key=wert oder key:=<json>)`,
    assignmentOperator: (key: string, op: string) =>
      `Property »${key}«: Zuweisung erwartet = oder :=, nicht ${op}`,
    filterError: (key: string, symbol: string, raw: string, why: string) =>
      `Filter ${key}${symbol}${raw}: ${why}`,
    comparisonNeedsNumber: 'der Vergleichswert muss eine Zahl sein',
    enumNotOrdered: 'das Enum ist nicht geordnet (ordered: true fehlt)',
    unknownEnumValue: (allowed: string) => `unbekannter Wert, erlaubt: ${allowed}`,
    rangeNotForType: (type: string) => `Bereichsvergleich geht nicht auf type »${type}«`,
  },
});
