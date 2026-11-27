import type { BacklogConfig, User } from '../core/schemas.ts';

/**
 * Admin ist, wer in `config.admins` steht und als Mensch existiert (backe.md §2.12). `record` ist
 * der Datensatz des Handles in dem Stand, der gerade gilt; fehlt er oder ist er ein Agent, ist das
 * Handle kein Admin.
 */
export function isAdmin(
  config: Pick<BacklogConfig, 'admins'>,
  handle: string,
  record: Pick<User, 'kind'> | undefined,
): boolean {
  return config.admins.includes(handle) && record?.kind === 'human';
}
