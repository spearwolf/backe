import type { ProblemJson } from '@backe/ui/api.ts';

/**
 * Das Problem eines kaputten Issues (z. B. defektes Frontmatter): Es steht nicht im Store, nur in
 * `problems`. Der Schlüssel allein genügt nicht, denn Projekt, Sprint und Repo haben ebenfalls Keys.
 */
export function issueProblem(
  problems: readonly ProblemJson[],
  id: string,
): ProblemJson | undefined {
  return problems.find((p) => p.kind === 'issue' && p.key === id);
}
