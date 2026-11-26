import { type Fetch, getJson } from './api-client.ts';

/** IDs der Issues, in denen `GET …/search` den Text findet (ui.md §2.3.1), in Listenordnung. */
export async function searchIds(backlog: string, q: string, fetchFn?: Fetch): Promise<string[]> {
  const path = `/api/b/${encodeURIComponent(backlog)}/search?q=${encodeURIComponent(q)}`;
  const res = await getJson<{ issues: { id: string }[] }>(path, fetchFn);
  return res.issues.map((i) => i.id);
}
