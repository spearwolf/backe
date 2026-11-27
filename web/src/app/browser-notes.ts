/**
 * Dünne Hülle um die Notification-API des Browsers. Sie läuft auch dort, wo es die API nicht gibt
 * (jsdom, ältere Browser): Jeder Zugriff ist geschützt, es gilt dann `'unsupported'`.
 */
export type NotePermission = 'unsupported' | 'default' | 'granted' | 'denied';

export type ShowNote = (n: {
  title: string;
  body: string;
  tag: string;
  onClick: () => void;
}) => void;

const api = (): typeof Notification | undefined =>
  typeof Notification === 'undefined' ? undefined : Notification;

export function notePermission(): NotePermission {
  const permission = api()?.permission;
  return permission === undefined ? 'unsupported' : permission;
}

/** Fragt nur bei `'default'`; sonst die aktuelle Erlaubnis. */
export async function requestNotePermission(): Promise<NotePermission> {
  const current = notePermission();
  if (current !== 'default') return current;
  try {
    await api()?.requestPermission();
  } catch {
    // Der Browser verweigert die Frage; maßgeblich bleibt, was er danach meldet.
  }
  return notePermission();
}

/** `new Notification(title, {body, tag})`, nur bei `'granted'`; Klick → Fokus, `onClick`, schließen. */
export const showBrowserNote: ShowNote = ({ title, body, tag, onClick }) => {
  const Note = api();
  if (Note === undefined || notePermission() !== 'granted') return;
  try {
    const note = new Note(title, { body, tag });
    note.onclick = () => {
      window.focus();
      onClick();
      note.close();
    };
  } catch {
    // Manche Browser (Android) erlauben `new Notification` nicht; dann bleibt es still.
  }
};
