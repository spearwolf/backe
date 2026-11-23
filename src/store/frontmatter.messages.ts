import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    commentsForbidden: 'comments are not allowed',
    anchorsForbidden: 'anchors are not allowed',
    aliasesForbidden: 'aliases are not allowed',
    tagsForbidden: 'tags are not allowed',
    directivesForbidden: 'directives are not allowed',
    multipleDocumentsForbidden: 'multiple documents are not allowed',
    mustStartWithFence: (file: string) => `${file}:1: Frontmatter must start with "---" on line 1`,
    missingClosingFence: (file: string) => `${file}:1: Frontmatter without closing "---" line`,
    invalidYaml: (message: string) => `invalid YAML: ${message}`,
    mustBeMap: 'Frontmatter must be a map',
    numberNotLossless: (literal: string) =>
      `Number ${literal} cannot be represented losslessly; write it as a string in quotes ("${literal}")`,
    emptyValuesAndNull: 'empty values and null are not allowed',
    keysMustBeStrings: 'keys must be strings',
    unsupportedYamlNode: 'unsupported YAML node',
    notSerializable: (value: string) => `value cannot be serialized: ${value}`,
    extraKeyCollides: (key: string) => `extra key '${key}' collides with another key`,
  },
  de: {
    commentsForbidden: 'Kommentare sind nicht erlaubt',
    anchorsForbidden: 'Anker sind nicht erlaubt',
    aliasesForbidden: 'Aliase sind nicht erlaubt',
    tagsForbidden: 'Tags sind nicht erlaubt',
    directivesForbidden: 'Direktiven sind nicht erlaubt',
    multipleDocumentsForbidden: 'mehrere Dokumente sind nicht erlaubt',
    mustStartWithFence: (file: string) =>
      `${file}:1: Frontmatter muss mit "---" in Zeile 1 beginnen`,
    missingClosingFence: (file: string) => `${file}:1: Frontmatter ohne schließende "---"-Zeile`,
    invalidYaml: (message: string) => `ungültiges YAML: ${message}`,
    mustBeMap: 'Frontmatter muss eine Map sein',
    numberNotLossless: (literal: string) =>
      `Zahl ${literal} ist nicht verlustfrei darstellbar; als String in Anführungszeichen schreiben ("${literal}")`,
    emptyValuesAndNull: 'leere Werte und null sind nicht erlaubt',
    keysMustBeStrings: 'Keys müssen Strings sein',
    unsupportedYamlNode: 'nicht unterstützter YAML-Knoten',
    notSerializable: (value: string) => `nicht serialisierbarer Wert: ${value}`,
    extraKeyCollides: (key: string) => `extra-Key »${key}« kollidiert mit einem anderen Key`,
  },
});
