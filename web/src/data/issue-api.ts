import type { AttachmentListJson, IssueDetailJson } from '@backe/ui/api.ts';
import { type Fetch, getJson } from './api-client.ts';

const issuePath = (backlog: string, id: string): string =>
  `/api/b/${encodeURIComponent(backlog)}/issues/${encodeURIComponent(id)}`;

/** `GET …/issues/<id>`: das Issue wie `issue show --comments all --format json`. */
export function fetchIssue(backlog: string, id: string, fetchFn?: Fetch): Promise<IssueDetailJson> {
  return getJson<IssueDetailJson>(issuePath(backlog, id), fetchFn);
}

/** `GET …/issues/<id>/attachments`: die Anhänge wie `attach list --format json`. */
export function fetchAttachments(
  backlog: string,
  id: string,
  fetchFn?: Fetch,
): Promise<AttachmentListJson> {
  return getJson<AttachmentListJson>(`${issuePath(backlog, id)}/attachments`, fetchFn);
}

/** Download-URL eines Anhangs; jeder Pfadabschnitt ist einzeln kodiert. */
export function attachmentUrl(backlog: string, id: string, name: string): string {
  return `${issuePath(backlog, id)}/attachments/${encodeURIComponent(name)}`;
}
