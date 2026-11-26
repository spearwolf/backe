import { catalog } from '../i18n/catalog.ts';
import type { ToolSurface } from './define.ts';

export const m = catalog({
  en: {
    invalidPropKey: (key: string) => `Invalid property key '${key}'`,
    invalidPropKeyHint: 'use lowercase letters, digits, _ . -, starting with a letter',
    nullOnlyInUpdate: (key: string) => `Property '${key}': null only works in issue_update`,
    invalidRank: (value: number) => `Invalid rank: '${value}'`,
    invalidRankHint: 'expects an integer',
    exactlyOnePosition: 'Give exactly one position',
    exactlyOnePositionHint: 'top, bottom, before, after or value',
    exactlyOneSource: 'Give exactly one of path, url, json, text',
    pathNotAvailable: "Parameter 'path' is not available here",
    pathNotAvailableHint: 'pass the content via text or json',
    batchEmpty: 'batch needs at least one operation',
    opNotAvailable: (line: number, op: string, surface: ToolSurface) =>
      `line ${line}: '${op}' is not available in ${surface === 'mcp' ? 'MCP mode' : 'backe ui'}`,
  },
  de: {
    invalidPropKey: (key: string) => `Ungültiger Property-Key '${key}'`,
    invalidPropKeyHint: 'Kleinbuchstaben, Ziffern, _ . - verwenden, beginnend mit einem Buchstaben',
    nullOnlyInUpdate: (key: string) => `Property '${key}': null funktioniert nur in issue_update`,
    invalidRank: (value: number) => `Ungültiger Rang: '${value}'`,
    invalidRankHint: 'erwartet eine ganze Zahl',
    exactlyOnePosition: 'Genau eine Position angeben',
    exactlyOnePositionHint: 'top, bottom, before, after oder value',
    exactlyOneSource: 'Genau eines von path, url, json, text angeben',
    pathNotAvailable: "Der Parameter 'path' ist hier nicht verfügbar",
    pathNotAvailableHint: 'den Inhalt über text oder json übergeben',
    batchEmpty: 'batch braucht mindestens eine Operation',
    opNotAvailable: (line: number, op: string, surface: ToolSurface) =>
      `Zeile ${line}: '${op}' ist ${surface === 'mcp' ? 'im MCP-Modus' : 'in backe ui'} nicht verfügbar`,
  },
});
