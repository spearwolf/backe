import { BackeError } from './errors.ts';
import { m } from './names.messages.ts';

/** Handle-Muster inkl. Ausschluss des reservierten `me`; als Muster, damit es ins JSON Schema wandert. */
export const HANDLE_PATTERN = /^(?!me$)[a-z0-9][a-z0-9-]{1,31}$/;
export const RESERVED_HANDLES: readonly string[] = ['me'];

/** Projektpfad: 1 bis 5 Segmente, durch `/` getrennt. */
export const PROJECT_PATH_RE = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,4}$/;
export const SPRINT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const REPO_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Name eines Backlogs; wird später Verzeichnis- und Dateiname. */
export const BACKLOG_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Strings, die später Git-Argumente werden (Remote, Branch, Ref): nicht leer, kein führendes
 * "-" (sonst liest Git sie als Option), kein Whitespace, keine Steuerzeichen (C0, DEL, C1).
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier gerade ausgeschlossen
export const GIT_ARG_RE = /^(?!-)[^\s\u0000-\u001f\u007f-\u009f]+$/;

export const ATTACHMENT_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const PROP_KEY_RE = /^[a-z][a-z0-9_.-]{0,63}$/;

export function isHandle(s: string): boolean {
  return HANDLE_PATTERN.test(s);
}

export function isProjectPath(s: string): boolean {
  return PROJECT_PATH_RE.test(s);
}

/** Echte Vorfahren eines Projektpfads, Wurzel zuerst; leer für ein Top-Level-Projekt. */
export function projectAncestors(path: string): string[] {
  const segments = path.split('/');
  const out: string[] = [];
  for (let i = 1; i < segments.length; i++) out.push(segments.slice(0, i).join('/'));
  return out;
}

export function isSprintSlug(s: string): boolean {
  return SPRINT_SLUG_RE.test(s);
}

export function isRepoName(s: string): boolean {
  return REPO_NAME_RE.test(s);
}

export function isBacklogName(s: string): boolean {
  return BACKLOG_NAME_RE.test(s);
}

export function isGitArg(s: string): boolean {
  return GIT_ARG_RE.test(s);
}

/**
 * Gültiger Git-Ref nach `git check-ref-format --allow-onelevel`: kein Segment beginnt mit `.` oder
 * endet auf `.lock`, kein `..`, `@{`, `@` allein, keine Steuerzeichen, Leerzeichen oder `~^:?*[\`,
 * kein führender oder abschließender `/`, kein `//`, kein abschließender `.`.
 */
export function isGitRef(s: string): boolean {
  if (s === '' || s === '@' || s.startsWith('/') || s.endsWith('/') || s.endsWith('.'))
    return false;
  if (s.includes('..') || s.includes('@{') || s.includes('//')) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier gerade ausgeschlossen
  if (/[\u0000-\u0020\u007f~^:?*[\\]/.test(s)) return false;
  return s.split('/').every((seg) => !seg.startsWith('.') && !seg.endsWith('.lock'));
}

/** Zerlegt `name` oder `name@ref` am ersten `@`; der Ref darf `/` und weitere `@` enthalten. */
export function parseRepoRef(s: string): { name: string; ref?: string } {
  const at = s.indexOf('@');
  const name = at < 0 ? s : s.slice(0, at);
  if (!isRepoName(name)) {
    throw new BackeError('validation', m.invalidRepoName(name), {
      hint: m.invalidRepoNameHint,
    });
  }
  if (at < 0) return { name };
  const ref = s.slice(at + 1);
  if (!isGitArg(ref) || !isGitRef(ref)) {
    throw new BackeError('validation', m.invalidRef(ref), {
      hint: m.invalidRefHint,
    });
  }
  return { name, ref };
}
