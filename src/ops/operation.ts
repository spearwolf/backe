/**
 * Operationen als Daten (backe.md §2.16.4): das Schema jeder Mutation, ihre Kodierung für den
 * Trailer `Backe-Op` (§2.13) und den Batch-Body (§2.16.6), die Zusammenfassung für die
 * Betreffzeile des Commits und das Umschreiben von Issue-IDs.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BackeError } from '../core/errors.ts';
import { isIssueId } from '../core/ids.ts';
import { isHandle, isProjectPath, isRepoName, isSprintSlug, PROP_KEY_RE } from '../core/names.ts';
import {
  IssueSchema,
  KEY_ORDER,
  ProjectSchema,
  RepoSchema,
  SprintSchema,
  UserSchema,
} from '../core/schemas.ts';
import { parseCommentFileName } from '../store/layout.ts';

/** Platzhalter für ein Issue, das erst im selben Batch entsteht (backe.md §2.16.6). */
export const PLACEHOLDER_RE = /^\$[A-Za-z0-9_-]{1,32}$/;

// --- Bausteine -----------------------------------------------------------------------------
// Feldprüfungen kommen aus den Entitätsschemas in core, damit Operation und gespeicherte Datei
// dieselben Regeln haben.

const issueFields = IssueSchema.shape;
const State = issueFields.state;
const Title = issueFields.title;
const Handle = issueFields.creator;
const Timestamp = issueFields.created;
const Rank = issueFields.rank.unwrap();
const IssueId = issueFields.id;
const ProjectList = issueFields.projects.unwrap();
const ProjectPath = ProjectList.element;
const SprintList = issueFields.sprints.unwrap();
const SprintSlug = SprintList.element;
const RepoRefList = issueFields.repos.unwrap();
const Props = issueFields.props.unwrap();
const PropValue = Props.valueType;
const attachmentFields = issueFields.attachments.unwrap().element.in.shape;
const RepoUrl = RepoSchema.shape.url;
const GitArg = RepoSchema.shape.default_ref.unwrap();
const DateOnly = SprintSchema.shape.start.unwrap();

const RepoName = z.string().refine(isRepoName, 'kein gültiger Repo-Name');
const IssueRef = z
  .string()
  .refine((s) => isIssueId(s) || PLACEHOLDER_RE.test(s), 'keine Issue-ID und kein Platzhalter');
const Placeholder = z.string().regex(PLACEHOLDER_RE, 'kein gültiger Platzhalter');
const Hash = z.string().regex(/^[0-9a-f]{64}$/, 'erwartet SHA-256 als 64 Hex-Zeichen');
const Reason = z.string().min(1);

const CommentFile = z
  .string()
  .refine((s) => parseCommentFileName(s) !== undefined, 'kein gültiger Kommentar-Dateiname');

/** Liste von Issue-Referenzen: nicht leer, ohne Duplikate. */
const RefList = z
  .array(IssueRef)
  .min(1)
  .refine((list) => new Set(list).size === list.length, 'enthält Duplikate');

/** Mindestens ein Schlüssel mit Wert; `undefined` zählt nicht, weil JSON ihn verliert. */
const hasKeys = (o: object) => Object.values(o).some((v) => v !== undefined);
const NOT_EMPTY = 'darf nicht leer sein';

/** Setzen mit Vorbedingung; `null` heißt »nicht gesetzt«. */
function fromTo<T extends z.ZodType>(value: T) {
  return z.strictObject({ from: value, to: value });
}

const BodyEdit = z.strictObject({ from_hash: Hash, to: z.string() });
const PropChange = fromTo(PropValue.nullable());

function present(o: object, keys: readonly string[]): string[] {
  return keys.filter((k) => (o as Record<string, unknown>)[k] !== undefined);
}

function quoted(keys: readonly string[]): string {
  return keys.map((k) => `»${k}«`).join(', ');
}

function exactlyOne(keys: readonly string[]) {
  return (o: object, ctx: z.RefinementCtx) => {
    if (present(o, keys).length !== 1)
      ctx.addIssue({ code: 'custom', message: `genau eines von ${quoted(keys)} erwartet` });
  };
}

// --- Varianten (Operationskatalog) ---------------------------------------------------------

const IssueCreate = z.strictObject({
  op: z.literal('issue.create'),
  ref: Placeholder.optional(),
  id: IssueId.optional(),
  title: Title,
  body: z.string().optional(),
  state: State.optional(),
  blocked_by: RefList.optional(),
  paused_from: issueFields.paused_from,
  parent: IssueRef.optional(),
  depends_on: RefList.optional(),
  rank: Rank.optional(),
  assignee: Handle.optional(),
  projects: ProjectList.optional(),
  sprints: SprintList.optional(),
  repos: RepoRefList.optional(),
  props: Props.refine(hasKeys, NOT_EMPTY).optional(),
  created: Timestamp.optional(),
});

const ListSection = z
  .strictObject({
    projects: ProjectList.min(1).optional(),
    sprints: SprintList.min(1).optional(),
    repos: RepoRefList.min(1).optional(),
    depends_on: RefList.optional(),
    blocked_by: RefList.optional(),
  })
  .refine(hasKeys, NOT_EMPTY);

const EDIT_SECTIONS = ['set', 'add', 'remove', 'props', 'body'] as const;

const IssueEdit = z
  .strictObject({
    op: z.literal('issue.edit'),
    id: IssueRef,
    set: z
      .strictObject({
        title: fromTo(Title).optional(),
        parent: fromTo(IssueRef.nullable()).optional(),
        assignee: fromTo(Handle.nullable()).optional(),
      })
      .refine(hasKeys, NOT_EMPTY)
      .optional(),
    add: ListSection.optional(),
    remove: ListSection.optional(),
    props: z
      .record(z.string().regex(PROP_KEY_RE, 'ungültiger Property-Key'), PropChange)
      .refine(hasKeys, NOT_EMPTY)
      .optional(),
    body: BodyEdit.optional(),
  })
  .refine(
    (e) => present(e, EDIT_SECTIONS).length > 0,
    `mindestens einer von ${quoted(EDIT_SECTIONS)} erwartet`,
  );

const reasonFields = { reason: Reason.optional(), reason_file: CommentFile.optional() };

/** Eine Datei für den Begründungskommentar braucht dessen Text. */
function reasonFileNeedsReason(
  o: { reason?: unknown; reason_file?: unknown },
  ctx: z.RefinementCtx,
) {
  if (o.reason_file !== undefined && o.reason === undefined) {
    ctx.addIssue({ code: 'custom', message: '»reason_file« nur zusammen mit »reason«' });
  }
}

const IssueMove = z
  .strictObject({
    op: z.literal('issue.move'),
    id: IssueRef,
    from: State,
    to: State,
    blocked_by: RefList.optional(),
    force: z.literal(true).optional(),
    ...reasonFields,
  })
  .superRefine(reasonFileNeedsReason);

const IssueResume = z
  .strictObject({
    op: z.literal('issue.resume'),
    id: IssueRef,
    from: State.extract(['blocked', 'on_hold']),
    ...reasonFields,
  })
  .superRefine(reasonFileNeedsReason);

const IssueReopen = z
  .strictObject({
    op: z.literal('issue.reopen'),
    id: IssueRef,
    from: State.extract(['done', 'cancelled', 'rejected']),
    to: State.extract(['backlog', 'todo', 'in_progress', 'review']).optional(),
    ...reasonFields,
  })
  .superRefine(reasonFileNeedsReason);

const IssueClaim = z.strictObject({ op: z.literal('issue.claim'), id: IssueRef });

const RANK_POSITIONS = ['top', 'bottom', 'before', 'after', 'value'] as const;

const IssueRank = z
  .strictObject({
    op: z.literal('issue.rank'),
    id: IssueRef,
    from: Rank.nullable(),
    top: z.literal(true).optional(),
    bottom: z.literal(true).optional(),
    before: IssueRef.optional(),
    after: IssueRef.optional(),
    value: Rank.optional(),
  })
  .superRefine(exactlyOne(RANK_POSITIONS));

const IssueLink = z
  .strictObject({
    op: z.literal('issue.link'),
    id: IssueRef,
    repo: RepoName.optional(),
    url: RepoUrl.optional(),
    ref: GitArg.optional(),
  })
  .superRefine(exactlyOne(['repo', 'url']));

const IssueUnlink = z.strictObject({ op: z.literal('issue.unlink'), id: IssueRef, repo: RepoName });

const IssueDelete = z.strictObject({
  op: z.literal('issue.delete'),
  id: IssueRef,
  force: z.literal(true).optional(),
  children: z.enum(['orphan', 'recursive']).optional(),
  blocker_comments: z.record(IssueRef, CommentFile).optional(),
});

const CommentAdd = z.strictObject({
  op: z.literal('comment.add'),
  id: IssueRef,
  body: z.string(),
  file: CommentFile.optional(),
});

const CommentEdit = z.strictObject({
  op: z.literal('comment.edit'),
  id: IssueRef,
  file: CommentFile,
  from_hash: Hash,
  body: z.string(),
});

const CommentDelete = z.strictObject({
  op: z.literal('comment.delete'),
  id: IssueRef,
  file: CommentFile,
});

const AttachAdd = z
  .strictObject({
    op: z.literal('attach.add'),
    id: IssueRef,
    name: attachmentFields.name,
    file: attachmentFields.file
      .unwrap()
      .refine((s) => s !== '.' && s !== '..', 'Dateiname darf nicht "." oder ".." sein')
      .optional(),
    url: attachmentFields.url.unwrap().optional(),
    /** Inhalt der Datei für `applyOperation`; geht nie in die Kodierung. */
    content: z.instanceof(Uint8Array).optional(),
  })
  .superRefine((a, ctx) => {
    exactlyOne(['file', 'url'])(a, ctx);
    if (a.content !== undefined && a.file === undefined) {
      ctx.addIssue({ code: 'custom', path: ['content'], message: 'nur zusammen mit "file"' });
    }
  });

const AttachRm = z.strictObject({
  op: z.literal('attach.rm'),
  id: IssueRef,
  name: attachmentFields.name,
});

const ProjectCreate = z.strictObject({
  op: z.literal('project.create'),
  path: ProjectPath,
  title: ProjectSchema.shape.title,
  lead: Handle.optional(),
  body: z.string().optional(),
});

const ProjectMv = z.strictObject({
  op: z.literal('project.mv'),
  from: ProjectPath,
  to: ProjectPath,
});

const ProjectRm = z
  .strictObject({
    op: z.literal('project.rm'),
    path: ProjectPath,
    reassign: ProjectPath.optional(),
    detach: z.literal(true).optional(),
  })
  .refine((p) => p.reassign === undefined || p.detach === undefined, {
    message: 'höchstens eines von "reassign" und "detach"',
  });

const SprintCreate = z.strictObject({
  op: z.literal('sprint.create'),
  slug: SprintSlug,
  title: SprintSchema.shape.title,
  start: DateOnly.optional(),
  end: DateOnly.optional(),
  body: z.string().optional(),
});

const SprintClose = z.strictObject({
  op: z.literal('sprint.close'),
  slug: SprintSlug,
  carry_over: SprintSlug.optional(),
});

const RepoAdd = z.strictObject({
  op: z.literal('repo.add'),
  url: RepoUrl,
  name: RepoName.optional(),
  default_ref: GitArg.optional(),
  body: z.string().optional(),
});

const RepoRm = z.strictObject({ op: z.literal('repo.rm'), name: RepoName });

const UserAdd = z.strictObject({
  op: z.literal('user.add'),
  handle: Handle,
  name: UserSchema.shape.name,
  kind: UserSchema.shape.kind,
  keys: UserSchema.shape.keys.unwrap().min(1),
  operator: Handle.optional(),
  body: z.string().optional(),
});

const UserRevokeKey = z.strictObject({
  op: z.literal('user.revoke_key'),
  handle: Handle,
  key: UserSchema.shape.keys.unwrap().element,
  revoked: Timestamp.optional(),
});

const UserRm = z.strictObject({ op: z.literal('user.rm'), handle: Handle });

const ENTITY_KEY_CHECKS = {
  project: isProjectPath,
  sprint: isSprintSlug,
  repo: isRepoName,
  user: isHandle,
} as const;

const ENTITY_SCHEMAS = {
  project: ProjectSchema,
  sprint: SprintSchema,
  repo: RepoSchema,
  user: UserSchema,
} as const;

/**
 * Prüft einen Wert von `entity.edit.set` gegen das Feld im Kernschema; `null` (»nicht gesetzt«)
 * nur, wo das Feld optional ist. Liefert die Fehlermeldung oder `undefined`.
 */
function fieldValueProblem(field: z.ZodType, value: unknown): string | undefined {
  const optional = field instanceof z.ZodOptional;
  if (value === null) return optional ? undefined : 'Pflichtfeld, null nicht erlaubt';
  // `value` ist nie `undefined` (PropChange verlangt einen Wert), die optionale Hülle stört nicht.
  const result = field.safeParse(value);
  return result.success ? undefined : result.error.issues.map((i) => i.message).join('; ');
}

const EntityEdit = z
  .strictObject({
    op: z.literal('entity.edit'),
    kind: z.enum(['project', 'sprint', 'repo', 'user']),
    key: z.string(),
    set: z.record(z.string(), PropChange).refine(hasKeys, NOT_EMPTY).optional(),
    body: BodyEdit.optional(),
  })
  .superRefine((e, ctx) => {
    if (!ENTITY_KEY_CHECKS[e.kind](e.key)) {
      ctx.addIssue({
        code: 'custom',
        path: ['key'],
        message: `kein gültiger Schlüssel für ${e.kind}`,
      });
    }
    const shape: Readonly<Record<string, z.ZodType>> = ENTITY_SCHEMAS[e.kind].shape;
    for (const [field, change] of Object.entries(e.set ?? {})) {
      const fieldSchema = shape[field];
      if (!KEY_ORDER[e.kind].includes(field) || fieldSchema === undefined) {
        ctx.addIssue({ code: 'custom', path: ['set', field], message: `kein Feld von ${e.kind}` });
        continue;
      }
      for (const side of ['from', 'to'] as const) {
        const message = fieldValueProblem(fieldSchema, change[side]);
        if (message !== undefined)
          ctx.addIssue({ code: 'custom', path: ['set', field, side], message });
      }
    }
    if (e.set === undefined && e.body === undefined) {
      ctx.addIssue({ code: 'custom', message: 'mindestens einer von "set", "body" erwartet' });
    }
  });

export const OperationSchema = z.discriminatedUnion(
  'op',
  [
    IssueCreate,
    IssueEdit,
    IssueMove,
    IssueResume,
    IssueReopen,
    IssueClaim,
    IssueRank,
    IssueLink,
    IssueUnlink,
    IssueDelete,
    CommentAdd,
    CommentEdit,
    CommentDelete,
    AttachAdd,
    AttachRm,
    ProjectCreate,
    ProjectMv,
    ProjectRm,
    SprintCreate,
    SprintClose,
    RepoAdd,
    RepoRm,
    UserAdd,
    UserRevokeKey,
    UserRm,
    EntityEdit,
  ],
  {
    error: (iss) => {
      // Laut Typ nur `invalid_union`; für Nicht-Objekte meldet zod zur Laufzeit `invalid_type`.
      const code: string = iss.code;
      return code === 'invalid_type'
        ? 'Operation muss ein JSON-Objekt sein'
        : 'unbekannte Operation';
    },
  },
);

export type Operation = z.infer<typeof OperationSchema>;
export type OpName = Operation['op'];
export type OpOf<N extends OpName> = Extract<Operation, { op: N }>;

// --- Kodierung -----------------------------------------------------------------------------

function validate(data: unknown, where: string): Operation {
  const result = OperationSchema.safeParse(data);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => {
    const path = i.path.length > 0 ? i.path.join('.') : '<root>';
    return `${where}${path}: ${i.message}`;
  });
  throw new BackeError('validation', `Ungültige Operation:\n${lines.join('\n')}`);
}

/** zod verwirft `__proto__` in Records still; die Operation käme dann verändert an. */
function rejectProtoKey(key: string, value: unknown): unknown {
  if (key === '__proto__') {
    throw new BackeError('validation', 'Key "__proto__" ist in Operationen nicht erlaubt');
  }
  return value;
}

function decode(text: string, where: string): Operation {
  let data: unknown;
  try {
    data = JSON.parse(text, rejectProtoKey);
  } catch (err) {
    // Die Ablehnung von `__proto__` kommt aus dem Reviver und bleibt, wie sie ist.
    if (err instanceof BackeError) throw new BackeError(err.code, `${where}${err.message}`);
    const reason = (err as SyntaxError).message;
    throw new BackeError('validation', `${where}Operation ist kein gültiges JSON: ${reason}`);
  }
  return validate(data, where);
}

/**
 * Kompaktes JSON in einer Zeile: `op` zuerst, dann die Felder in Schema-Reihenfolge, Maps in
 * ihrer gegebenen Reihenfolge. zod baut die Ausgabe in Shape-Reihenfolge auf; ein Test hält das
 * fest. `content` wird nie kodiert. U+2028, U+2029 und U+0085 lässt `JSON.stringify` roh stehen;
 * sie werden als `\uXXXX` geschrieben, damit ein zeilenbasierter Trailer-Parser nicht daran
 * trennt (`JSON.parse` liest beide Formen). Die Ausgabe wird selbst wieder dekodiert, damit kein
 * Trailer entsteht, den das Replay nicht lesen kann.
 */
export function encodeOp(op: Operation): string {
  const parsed = validate(op, '');
  let json: string;
  if (parsed.op === 'attach.add') {
    const { content: _, ...rest } = parsed;
    json = JSON.stringify(rest);
  } else {
    json = JSON.stringify(parsed);
  }
  const text = json.replace(
    /[\u2028\u2029\u0085]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  try {
    decodeOp(text);
  } catch (err) {
    const reason = err instanceof BackeError ? err.message : String(err);
    throw new BackeError('unexpected', `Kodierte Operation ist nicht dekodierbar: ${reason}`);
  }
  return text;
}

export function decodeOp(text: string): Operation {
  return decode(text, '');
}

/** SHA-256 (hex) eines Bodys, unabhängig vom Zeilenende-Stil. */
export function bodyHash(body: string): string {
  return createHash('sha256').update(body.replace(/\r\n?/g, '\n'), 'utf8').digest('hex');
}

export const TRAILER_LITERALS = ['batch', 'manual', 'init'] as const;

export type OpTrailer = { kind: 'op'; op: Operation } | { kind: (typeof TRAILER_LITERALS)[number] };

/** Wert des Trailers `Backe-Op` (backe.md §2.13). */
export function parseOpTrailer(value: string): OpTrailer {
  const literal = TRAILER_LITERALS.find((l) => l === value);
  return literal !== undefined ? { kind: literal } : { kind: 'op', op: decodeOp(value) };
}

/** Body eines Batch-Commits: eine Operation pro Zeile, `\n` am Ende (backe.md §2.16.6). */
export function encodeBatchBody(ops: readonly Operation[]): string {
  return ops.map((op) => `${encodeOp(op)}\n`).join('');
}

export function decodeBatchBody(text: string): Operation[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((line, i) => {
    const where = `Zeile ${i + 1}: `;
    if (line === '') throw new BackeError('validation', `${where}leere Zeile`);
    return decode(line, where);
  });
}

// --- Zusammenfassung -----------------------------------------------------------------------

function subjectOf(op: Operation): string | undefined {
  switch (op.op) {
    case 'issue.create':
      return op.id ?? op.ref;
    case 'project.create':
    case 'project.rm':
      return op.path;
    case 'project.mv':
      return op.from;
    case 'sprint.create':
    case 'sprint.close':
      return op.slug;
    case 'repo.add':
      return op.name ?? op.url;
    case 'repo.rm':
      return op.name;
    case 'user.add':
    case 'user.revoke_key':
    case 'user.rm':
      return op.handle;
    case 'entity.edit':
      return `${op.kind} ${op.key}`;
    default:
      return op.id;
  }
}

function rankFlag(op: OpOf<'issue.rank'>): string {
  if (op.top) return '--top';
  if (op.bottom) return '--bottom';
  if (op.before !== undefined) return `--before ${op.before}`;
  if (op.after !== undefined) return `--after ${op.after}`;
  return String(op.value);
}

function detailOf(op: Operation): string | undefined {
  switch (op.op) {
    case 'issue.move':
    case 'issue.reopen':
    case 'project.mv':
      return op.to;
    case 'issue.rank':
      return rankFlag(op);
    default:
      return undefined;
  }
}

/** Betreffzeile eines Commits, z. B. `issue move bk-7f3k2 review` (backe.md §2.13). */
export function summarizeOp(op: Operation): string {
  return [op.op.replace('.', ' '), subjectOf(op), detailOf(op)]
    .filter((part) => part !== undefined)
    .join(' ');
}

/** `batch: 34 create, 12 move, 3 comment.add` — Reihenfolge des ersten Auftretens. */
export function summarizeBatch(ops: readonly Operation[]): string {
  const counts = new Map<string, number>();
  for (const { op } of ops) {
    const label = op.startsWith('issue.') ? op.slice('issue.'.length) : op;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return `batch: ${[...counts].map(([label, n]) => `${n} ${label}`).join(', ')}`;
}

// --- Issue-IDs -----------------------------------------------------------------------------

/** Feldnamen, die in jeder Operation, die sie trägt, eine Issue-ID bzw. eine Liste davon sind. */
const ID_FIELDS = ['id', 'parent', 'before', 'after'] as const;
const ID_LIST_FIELDS = ['depends_on', 'blocked_by'] as const;

/** Kopie von `o` mit umgeschriebenen ID-Feldern; die Schlüsselreihenfolge bleibt. */
function mapIdFields<T extends object>(o: T, f: (id: string) => string): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of ID_FIELDS) {
    const v = out[k];
    if (typeof v === 'string') out[k] = f(v);
  }
  for (const k of ID_LIST_FIELDS) {
    const v = out[k];
    if (Array.isArray(v)) out[k] = v.map((id: string) => f(id));
  }
  return out as T;
}

function mapIds(op: Operation, f: (id: string) => string): Operation {
  const out = mapIdFields(op, f);
  if (out.op === 'issue.edit') {
    if (out.set?.parent !== undefined) {
      const { from, to } = out.set.parent;
      const mapNullable = (id: string | null) => (id === null ? null : f(id));
      out.set = { ...out.set, parent: { from: mapNullable(from), to: mapNullable(to) } };
    }
    if (out.add !== undefined) out.add = mapIdFields(out.add, f);
    if (out.remove !== undefined) out.remove = mapIdFields(out.remove, f);
  }
  if (out.op === 'issue.delete' && out.blocker_comments !== undefined) {
    out.blocker_comments = Object.fromEntries(
      Object.entries(out.blocker_comments).map(([id, file]) => [f(id), file]),
    );
  }
  return out;
}

/**
 * Ersetzt Issue-IDs und Platzhalter in allen Issue-ID-Feldern: Subjekt, `parent`, `depends_on`,
 * `blocked_by`, `before`/`after`, `add`/`remove`, `set.parent`, Schlüssel von `blocker_comments`.
 * Für Batch-Platzhalter und das Umschreiben nach einer ID-Kollision (backe.md §2.16.4).
 */
export function substituteIds(op: Operation, map: ReadonlyMap<string, string>): Operation {
  return mapIds(op, (id) => map.get(id) ?? id);
}

/** Alle Issue-IDs und Platzhalter, die die Operation nennt, ohne Duplikate. */
export function referencedIds(op: Operation): string[] {
  const seen = new Set<string>();
  mapIds(op, (id) => {
    seen.add(id);
    return id;
  });
  return [...seen];
}
