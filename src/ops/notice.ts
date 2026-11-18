/** Hinweise, die eine Operation neben ihrem Ergebnis meldet. */
export type NoticeCode =
  | 'open_children'
  | 'forced_done'
  | 'blocker_deleted'
  | 'settled_dependency'
  | 'unblockable';

export type Notice = { code: NoticeCode; message: string; ids: string[] };
