import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { BacklogConfigSchema, ProjectConfigSchema, UserConfigSchema } from '../src/core/schemas.ts';

export const SCHEMA_FILES: ReadonlyArray<readonly [string, z.ZodType]> = [
  ['backlog.schema.json', BacklogConfigSchema],
  ['user-config.schema.json', UserConfigSchema],
  ['project-config.schema.json', ProjectConfigSchema],
];

if (import.meta.main) {
  const dir = new URL('../schemas/', import.meta.url);
  await mkdir(dir, { recursive: true });
  for (const [file, schema] of SCHEMA_FILES) {
    await writeFile(
      new URL(file, dir),
      `${JSON.stringify(z.toJSONSchema(schema, { io: 'input' }), null, 2)}\n`,
    );
  }
}
