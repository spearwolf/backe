import { BackeError } from './errors.ts';

export const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
export const RESERVED_HANDLES: readonly string[] = ['me'];

const PROJECT_SEGMENT_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_PROJECT_DEPTH = 5;
const SPRINT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REPO_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

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
  return HANDLE_RE.test(s) && !RESERVED_HANDLES.includes(s);
}

export function isProjectPath(s: string): boolean {
  const segments = s.split('/');
  return (
    segments.length <= MAX_PROJECT_DEPTH && segments.every((seg) => PROJECT_SEGMENT_RE.test(seg))
  );
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

/** Zerlegt `name` oder `name@ref` am ersten `@`; der Ref darf `/` und weitere `@` enthalten. */
export function parseRepoRef(s: string): { name: string; ref?: string } {
  const at = s.indexOf('@');
  const name = at < 0 ? s : s.slice(0, at);
  if (!isRepoName(name)) {
    throw new BackeError('validation', `Ungültiger Repo-Name: "${name}"`, {
      hint: 'Erlaubt sind a-z, 0-9, ".", "_" und "-", beginnend mit Buchstabe oder Ziffer (max. 64 Zeichen).',
    });
  }
  if (at < 0) return { name };
  const ref = s.slice(at + 1);
  if (!isGitArg(ref)) {
    throw new BackeError('validation', `Ungültiger Ref in "${s}"`, {
      hint: 'Form: <repo>@<ref>, z. B. webapp@main. Der Ref ist nicht leer, beginnt nicht mit "-" und enthält weder Leer- noch Steuerzeichen.',
    });
  }
  return { name, ref };
}
