import { z } from 'zod';
import { BackeError } from './errors.ts';
import { isIssueId, PREFIX_RE } from './ids.ts';
import {
  ATTACHMENT_NAME_RE,
  BACKLOG_NAME_RE,
  GIT_ARG_RE,
  HANDLE_PATTERN,
  isProjectPath,
  isSprintSlug,
  PROJECT_PATH_RE,
  PROP_KEY_RE,
  parseRepoRef,
  REPO_NAME_RE,
  SPRINT_SLUG_RE,
} from './names.ts';
import { parseSshPublicKey } from './ssh.ts';
import type { State } from './state.ts';
import { normalizeRepoUrl } from './url.ts';

export type EntityKind = 'issue' | 'comment' | 'user' | 'project' | 'sprint' | 'repo';

/** Reihenfolge der Schlüssel je Entität; Grundlage der kanonischen Serialisierung (backe.md §2.4). */
export const KEY_ORDER: Readonly<Record<EntityKind, readonly string[]>> = {
  issue: [
    'id',
    'title',
    'state',
    'blocked_by',
    'paused_from',
    'parent',
    'depends_on',
    'rank',
    'creator',
    'assignee',
    'projects',
    'sprints',
    'repos',
    'attachments',
    'created',
    'props',
  ],
  comment: ['author', 'created', 'kind', 'from', 'to'],
  user: ['name', 'kind', 'operator', 'keys', 'revoked_keys'],
  project: ['title', 'lead'],
  sprint: ['title', 'start', 'end', 'closed'],
  repo: ['url', 'default_ref'],
};

// --- Primitive -------------------------------------------------------------

const STATES = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'blocked',
  'on_hold',
  'cancelled',
  'rejected',
] as const satisfies readonly State[];
const StateSchema = z.enum(STATES);
const PausedFromSchema = z.enum(['backlog', 'todo', 'in_progress', 'review']);

const nonEmpty = z.string().min(1);
/** Als `regex`, nicht als `refine`, damit das Muster ins JSON Schema übernommen wird. */
const BacklogName = z.string().regex(BACKLOG_NAME_RE, 'ungültiger Backlog-Name');
const GitArg = z
  .string()
  .regex(GIT_ARG_RE, 'nicht leer, ohne führendes "-", ohne Leer- und Steuerzeichen erwartet');
const Handle = z.string().regex(HANDLE_PATTERN, 'kein gültiger Handle');
const IssueIdSchema = z.string().refine((s) => isIssueId(s), 'keine gültige Issue-ID');

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealTimestamp(s: string): boolean {
  if (!TIMESTAMP_RE.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && `${d.toISOString().slice(0, 19)}Z` === s;
}

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const Timestamp = z
  .string()
  .refine(isRealTimestamp, 'erwartet UTC-Zeitstempel YYYY-MM-DDTHH:MM:SSZ');
const DateOnly = z.string().refine(isRealDate, 'erwartet Datum YYYY-MM-DD');

/** Liste ohne Duplikate. */
function uniqueList<T extends z.ZodType<string>>(item: T) {
  return z.array(item).superRefine((list, ctx) => {
    if (new Set(list).size !== list.length)
      ctx.addIssue({ code: 'custom', message: 'enthält Duplikate' });
  });
}

const SSH_KEY_RE = /^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [^\r\n]*)?$/;
/** Form per Regex, Inhalt per `parseSshPublicKey`: ein Key im Schema ist für `sameKey` und `sshFingerprint` lesbar. */
const SshKey = z
  .string()
  .refine((s) => SSH_KEY_RE.test(s), 'erwartet "ssh-ed25519 <base64> [kommentar]"')
  .superRefine((s, ctx) => {
    if (!SSH_KEY_RE.test(s)) return;
    try {
      parseSshPublicKey(s);
    } catch (err) {
      if (!(err instanceof BackeError)) throw err;
      ctx.addIssue({ code: 'custom', message: err.message });
    }
  });

// --- Custom Properties (backe.md §2.24) ----------------------------------------

export type PropValue = string | number | boolean | PropValue[] | { [key: string]: PropValue };

const PropValueSchema: z.ZodType<PropValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().refine((v) => !Object.is(v, -0), '-0 ist kein gültiger Wert'),
    z.boolean(),
    z.array(PropValueSchema),
    z.record(z.string(), PropValueSchema),
  ]),
);

const PropsSchema = z.record(z.string(), PropValueSchema).superRefine((props, ctx) => {
  for (const k of Object.keys(props)) {
    if (!PROP_KEY_RE.test(k))
      ctx.addIssue({ code: 'custom', path: [k], message: 'ungültiger Property-Key' });
  }
});

// --- Issue (backe.md §2.4) -------------------------------------------------------

const AttachmentSchema = z
  .strictObject({
    name: z.string().regex(ATTACHMENT_NAME_RE, 'ungültiger Anhangsname'),
    file: z
      .string()
      .min(1)
      .refine((s) => !s.includes('/'), 'Dateiname ohne "/"')
      .optional(),
    url: z
      .string()
      .refine((s) => /^https?:\/\/./.test(s), 'erwartet http(s)-URL')
      .optional(),
  })
  .superRefine((a, ctx) => {
    if ((a.file === undefined) === (a.url === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'genau eines von "file" oder "url" erwartet' });
    }
  });

const Title = z
  .string()
  .refine((s) => s.length > 0 && [...s].length <= 200, '1 bis 200 Zeichen erwartet')
  .refine((s) => !/[\r\n]/.test(s), 'muss einzeilig sein');

export const IssueSchema = z
  .object({
    id: IssueIdSchema,
    title: Title,
    state: StateSchema,
    blocked_by: uniqueList(IssueIdSchema).optional(),
    paused_from: PausedFromSchema.optional(),
    parent: IssueIdSchema.optional(),
    depends_on: uniqueList(IssueIdSchema).optional(),
    rank: z.number().int().optional(),
    creator: Handle,
    assignee: Handle.optional(),
    projects: uniqueList(z.string().refine(isProjectPath, 'kein gültiger Projekt-Pfad')).optional(),
    sprints: uniqueList(z.string().refine(isSprintSlug, 'kein gültiger Sprint-Slug')).optional(),
    repos: uniqueList(
      z.string().refine((s) => {
        try {
          parseRepoRef(s);
          return true;
        } catch {
          return false;
        }
      }, 'erwartet "name" oder "name@ref"'),
    ).optional(),
    attachments: z
      .array(AttachmentSchema)
      .superRefine((list, ctx) => {
        const names = list.map((a) => a.name);
        if (new Set(names).size !== names.length) {
          ctx.addIssue({ code: 'custom', message: 'Anhangsnamen müssen eindeutig sein' });
        }
      })
      .optional(),
    created: Timestamp,
    props: PropsSchema.optional(),
  })
  .superRefine((issue, ctx) => {
    const paused = issue.state === 'blocked' || issue.state === 'on_hold';
    if (issue.state === 'blocked') {
      if (!issue.blocked_by || issue.blocked_by.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['blocked_by'],
          message: 'bei state "blocked" mindestens eine ID erforderlich',
        });
      }
    } else if (issue.blocked_by !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['blocked_by'],
        message: 'nur bei state "blocked" erlaubt',
      });
    }
    if (paused && issue.paused_from === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['paused_from'],
        message: 'bei "blocked"/"on_hold" erforderlich',
      });
    } else if (!paused && issue.paused_from !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['paused_from'],
        message: 'nur bei "blocked"/"on_hold" erlaubt',
      });
    }
    if (issue.blocked_by?.includes(issue.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['blocked_by'],
        message: 'darf nicht die eigene ID enthalten',
      });
    }
    if (issue.depends_on?.includes(issue.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['depends_on'],
        message: 'darf nicht die eigene ID enthalten',
      });
    }
    if (issue.parent === issue.id) {
      ctx.addIssue({ code: 'custom', path: ['parent'], message: 'darf nicht die eigene ID sein' });
    }
  });

// --- Kommentar, User, Projekt, Sprint, Repo --------------------------------------

export const CommentSchema = z
  .object({
    author: Handle,
    created: Timestamp,
    kind: z.enum(['comment', 'transition']).optional(),
    from: StateSchema.optional(),
    to: StateSchema.optional(),
  })
  .superRefine((c, ctx) => {
    const transition = c.kind === 'transition';
    for (const k of ['from', 'to'] as const) {
      if (transition && c[k] === undefined) {
        ctx.addIssue({ code: 'custom', path: [k], message: 'bei kind "transition" erforderlich' });
      } else if (!transition && c[k] !== undefined) {
        ctx.addIssue({ code: 'custom', path: [k], message: 'nur bei kind "transition" erlaubt' });
      }
    }
  });

export const UserSchema = z
  .object({
    name: nonEmpty,
    kind: z.enum(['human', 'agent']),
    operator: Handle.optional(),
    keys: uniqueList(SshKey),
    revoked_keys: z.array(z.strictObject({ key: SshKey, revoked: Timestamp })).optional(),
  })
  .superRefine((u, ctx) => {
    if (u.kind === 'agent' && u.operator === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['operator'],
        message: 'bei kind "agent" erforderlich',
      });
    } else if (u.kind === 'human' && u.operator !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['operator'],
        message: 'bei kind "human" nicht erlaubt',
      });
    }
  });

export const ProjectSchema = z.object({ title: nonEmpty, lead: Handle.optional() });

export const SprintSchema = z
  .object({
    title: nonEmpty,
    start: DateOnly.optional(),
    end: DateOnly.optional(),
    closed: z.boolean().optional(),
  })
  .superRefine((s, ctx) => {
    if (
      s.start !== undefined &&
      s.end !== undefined &&
      isRealDate(s.start) &&
      isRealDate(s.end) &&
      s.end < s.start
    ) {
      ctx.addIssue({ code: 'custom', path: ['end'], message: 'darf nicht vor "start" liegen' });
    }
  });

export const RepoSchema = z.object({
  url: z.string().refine((s) => {
    try {
      normalizeRepoUrl(s);
      return true;
    } catch {
      return false;
    }
  }, 'keine gültige Repo-URL'),
  default_ref: GitArg.optional(),
});

export type Issue = z.infer<typeof IssueSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type User = z.infer<typeof UserSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Sprint = z.infer<typeof SprintSchema>;
export type Repo = z.infer<typeof RepoSchema>;

const ENTITY_SCHEMAS = {
  issue: IssueSchema,
  comment: CommentSchema,
  user: UserSchema,
  project: ProjectSchema,
  sprint: SprintSchema,
  repo: RepoSchema,
} as const satisfies Record<EntityKind, z.ZodType>;

/**
 * Lehnt `__proto__` als Key in `props` in jeder Tiefe ab. Zod verwirft den Key sonst still,
 * dann ginge er beim Schreiben unbemerkt verloren. Iterativ, damit die Tiefe keine Rolle spielt.
 */
function assertNoProtoKey(data: unknown, file: string): void {
  const props = (data as { props?: unknown } | null)?.props;
  const stack: [unknown, string][] = [[props, 'props']];
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    const [value, path] = top;
    if (typeof value !== 'object' || value === null) continue;
    for (const [k, v] of Object.entries(value)) {
      const childPath = `${path}.${k}`;
      if (k === '__proto__') {
        throw new BackeError(
          'validation',
          `${file}: ${childPath}: Key "__proto__" ist nicht erlaubt`,
        );
      }
      stack.push([v, childPath]);
    }
  }
}

/**
 * Prüft eine geparste Entität. Unbekannte Top-Level-Keys bleiben aus `data` draußen
 * und werden in Originalreihenfolge als `unknownKeys` gemeldet.
 */
export function validateEntity(
  kind: EntityKind,
  data: unknown,
  file: string,
): { data: object; unknownKeys: string[] } {
  if (kind === 'issue') assertNoProtoKey(data, file);
  const result = ENTITY_SCHEMAS[kind].safeParse(data);
  if (!result.success) {
    const lines = result.error.issues.map((i) => {
      const path = i.path.length > 0 ? i.path.join('.') : '<root>';
      return `${file}: ${path}: ${i.message}`;
    });
    throw new BackeError('validation', lines.join('\n'));
  }
  const known = new Set(KEY_ORDER[kind]);
  const unknownKeys = Object.keys(data as object).filter((k) => !known.has(k));
  return { data: result.data as object, unknownKeys };
}

// --- Configs (backe.md §2.15) ----------------------------------------------------

const SchemaRef = z.string().optional();

const ProjectPath = z.string().regex(PROJECT_PATH_RE, 'ungültiger Projektpfad');
const SprintSlug = z.string().regex(SPRINT_SLUG_RE, 'ungültiger Sprint-Slug');
const RepoName = z.string().regex(REPO_NAME_RE, 'ungültiger Repo-Name');
/** Ein lokaler Pfad; `~name/…` (Home eines anderen Users) wird beim Expandieren nicht unterstützt. */
const LocalPath = nonEmpty.regex(
  /^(?!~[^/])/,
  '~name wird nicht unterstützt, nur ~/… oder ein Pfad',
);
/** Eine Repo-URL, die `normalizeRepoUrl` zur kanonischen Form auflösen kann. */
const RepoUrl = GitArg.refine(normalizesWithoutError, 'keine erkennbare Repo-URL');

/**
 * Kanonische Formen (`<host>/<pfad>`, `file:<abs-pfad>`) sind selbst keine gültigen Eingaben für
 * `normalizeRepoUrl`; ein Key ist kanonisch, wenn die Normalisierung ihn unverändert zurückgibt.
 */
function isCanonicalRepoKey(k: string): boolean {
  try {
    const input = k.startsWith('file:') ? k.slice('file:'.length) : `https://${k}`;
    return normalizeRepoUrl(input) === k;
  } catch {
    return false;
  }
}

function normalizesWithoutError(s: string): boolean {
  try {
    normalizeRepoUrl(s);
    return true;
  } catch {
    return false;
  }
}

const PropDeclarationSchema = z
  .strictObject({
    type: z.enum(['string', 'integer', 'number', 'boolean', 'enum', 'json']),
    description: nonEmpty,
    values: z.array(nonEmpty).optional(),
    ordered: z.boolean().optional(),
  })
  .superRefine((p, ctx) => {
    if (p.type === 'enum') {
      if (p.values === undefined || p.values.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['values'],
          message: 'bei type "enum" erforderlich und nicht leer',
        });
      } else if (new Set(p.values).size !== p.values.length) {
        ctx.addIssue({ code: 'custom', path: ['values'], message: 'Werte müssen eindeutig sein' });
      }
    } else {
      if (p.values !== undefined)
        ctx.addIssue({ code: 'custom', path: ['values'], message: 'nur bei type "enum" erlaubt' });
      if (p.ordered !== undefined)
        ctx.addIssue({ code: 'custom', path: ['ordered'], message: 'nur bei type "enum" erlaubt' });
    }
  });

export const BacklogConfigSchema = z.strictObject({
  $schema: SchemaRef,
  version: z.number().int().min(1),
  name: BacklogName,
  id_prefix: z.string().regex(PREFIX_RE, 'ungültiges Präfix'),
  admins: z.array(Handle).min(1),
  workflow: z.strictObject({ strict: z.boolean().default(false) }).default({ strict: false }),
  sync: z
    .strictObject({
      mode: z.enum(['auto', 'manual']).default('auto'),
      remote: GitArg.default('origin'),
      branch: GitArg.default('main'),
      pull_interval: z.number().int().min(0).default(60),
    })
    .default({ mode: 'auto', remote: 'origin', branch: 'main', pull_interval: 60 }),
  verify: z.enum(['strict', 'warn', 'off']).default('strict'),
  attachments: z
    .strictObject({
      max_bytes: z.number().int().positive().nullable().default(10485760),
      lfs: z.boolean().default(false),
    })
    .default({ max_bytes: 10485760, lfs: false }),
  props_strict: z.boolean().default(false),
  props: z
    .record(z.string().regex(PROP_KEY_RE, 'ungültiger Property-Key'), PropDeclarationSchema)
    .default({}),
});

/** Formatversion, die `backe` in `.backe/backlog.jsonc` schreibt und lesen kann. */
export const BACKLOG_FORMAT_VERSION = 1;

/** Entscheidungen zu quarantänierten Commits (`.backe/quarantine.jsonc`). */
export const QuarantineSchema = z.strictObject({
  $schema: SchemaRef,
  entries: z.array(
    z.strictObject({
      sha: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/),
      decision: z.enum(['accepted', 'reverted']),
      reason: nonEmpty,
    }),
  ),
});
export type Quarantine = z.infer<typeof QuarantineSchema>;

export const UserConfigSchema = z.strictObject({
  $schema: SchemaRef,
  current: BacklogName.optional(),
  user: Handle.optional(),
  project: ProjectPath.optional(),
  sprint: SprintSlug.optional(),
  identities: z
    .record(BacklogName, z.record(Handle, z.strictObject({ key: LocalPath })))
    .optional(),
  backlogs: z
    .record(
      BacklogName,
      z.strictObject({
        remote: RepoUrl.optional(),
        user: Handle.optional(),
        project: ProjectPath.optional(),
        sprint: SprintSlug.optional(),
        paths: z.record(Handle, LocalPath).optional(),
        sync: z.strictObject({ mode: z.enum(['auto', 'manual']) }).optional(),
      }),
    )
    .optional(),
  repos: z
    .record(z.string().refine(isCanonicalRepoKey, 'Key ist keine kanonische Repo-URL'), LocalPath)
    .optional(),
  output: z
    .strictObject({
      format: z.enum(['text', 'json', 'md']).optional(),
      color: z.enum(['auto', 'always', 'never']).optional(),
    })
    .optional(),
});

const projectConfigShape = {
  $schema: SchemaRef,
  backlog: z.union([BacklogName, RepoUrl]).optional(),
  project: ProjectPath.optional(),
  sprint: SprintSlug.optional(),
  repo: RepoName.nullable().optional(),
};

/** `.backlog.jsonc` — eingecheckt, daher ohne `user`. */
export const ProjectConfigSchema = z.strictObject(projectConfigShape);
/** `.backlog.local.jsonc` — persönlich, darf zusätzlich `user` setzen. */
export const ProjectLocalConfigSchema = z.strictObject({
  ...projectConfigShape,
  user: Handle.optional(),
});

export type BacklogConfig = z.infer<typeof BacklogConfigSchema>;
export type UserConfig = z.infer<typeof UserConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type ProjectLocalConfig = z.infer<typeof ProjectLocalConfigSchema>;
