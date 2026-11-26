import type { ToolArgs, ToolResults, UiToolName, WriteResultJson } from '@backe/ui/api.ts';
import { type Fetch, postJson, putBytes } from './api-client.ts';

const base = (backlog: string) => `/api/b/${encodeURIComponent(backlog)}`;

/** Ruft ein Tool des Backlogs auf; den neuen Zustand bringt der Event-Stream, nicht die Antwort. */
export function callTool<N extends UiToolName>(
  backlog: string,
  name: N,
  args: ToolArgs[N],
  fetchFn?: Fetch,
): Promise<ToolResults[N]> {
  return postJson<ToolResults[N]>(
    `${base(backlog)}/tools/${encodeURIComponent(name)}`,
    args,
    fetchFn,
  );
}

export function uploadAttachment(
  backlog: string,
  id: string,
  name: string,
  bytes: Blob,
  fetchFn?: Fetch,
): Promise<WriteResultJson> {
  return putBytes<WriteResultJson>(
    `${base(backlog)}/issues/${encodeURIComponent(id)}/attachments/${encodeURIComponent(name)}`,
    bytes,
    fetchFn,
  );
}
