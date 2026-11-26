const MAX_LENGTH = 64;

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

/** Reduziert auf `[a-z0-9._-]`, ohne `-`-Läufe und ohne führende Zeichen vor dem ersten `[a-z0-9]`. */
function slug(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-z0-9]+/, '');
}

/**
 * Gültiger, im Issue eindeutiger Anhangsname mit Endung (Endung aus dem Namen, sonst aus dem
 * MIME-Typ). Immer mit Endung, damit `file === name` gilt (BK §2.8); passt auf `ATTACHMENT_NAME_RE`.
 */
export function attachmentNameFor(
  fileName: string,
  mime: string,
  taken: ReadonlySet<string>,
): string {
  const clean = slug(fileName);
  const dot = clean.lastIndexOf('.');
  // Ein Name wie `.hidden` verliert im Slug sein Punkt-Präfix und hat dann keine Endung.
  let stem = dot > 0 ? clean.slice(0, dot) : clean;
  let ext = dot > 0 ? clean.slice(dot + 1) : '';
  if (ext === '') ext = MIME_EXT[mime] ?? 'bin';
  stem = stem.replace(/[._-]+$/, '');
  if (stem === '') stem = mime.startsWith('image/') ? 'image' : 'file';
  ext = ext.slice(0, 16);

  const build = (suffix: string): string => {
    const room = MAX_LENGTH - ext.length - 1 - suffix.length;
    return `${stem.slice(0, room)}${suffix}.${ext}`;
  };
  let name = build('');
  for (let n = 2; taken.has(name); n++) name = build(`-${n}`);
  return name;
}

/** Der Link, den der Editor für ein eingefügtes Bild schreibt; relativ zum Issue (BK §2.8). */
export function attachmentLink(name: string): string {
  return `![${name}](attachments/${name})`;
}

/** Zeichen, die in einem Anhangsnamen stehen dürfen (`ATTACHMENT_NAME_RE`). */
const NAME_CHAR = '[a-z0-9._-]';

/**
 * Ob der Text auf den Anhang verweist, gleich in welcher Form: Markdown-Link mit oder ohne Titel,
 * `<img src>` oder Referenz-Definition. Gesucht wird `attachments/<name>` mit Grenzen, an denen
 * kein Namenszeichen steht — `a.png` trifft so weder `a.png.bak` noch `xa.png`. Punkte dahinter
 * zählen erst, wenn ein weiteres Namenszeichen folgt: `attachments/a.png.` am Satzende verweist.
 */
export function mentionsAttachment(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<!${NAME_CHAR})attachments/${escaped}(?!\\.*[a-z0-9_-])`).test(text);
}
