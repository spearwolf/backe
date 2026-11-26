import { createContext, useContext } from 'react';
import type { Writes } from './writes.ts';

/**
 * Was eine Ansicht zum Schreiben braucht, je Backlog-Sitzung: ob sie darf (`can_write` des
 * Eintrags), wer sie ist (für »mir zuweisen«) und den Weg zum Server.
 */
export type WriteAccess = {
  backlog: string;
  canWrite: boolean;
  me: string | null;
  writes: Writes;
};

export const WriteContext = createContext<WriteAccess | null>(null);

export function useWrites(): WriteAccess {
  const access = useContext(WriteContext);
  if (access === null) throw new Error('useWrites needs a <WriteContext.Provider>');
  return access;
}
