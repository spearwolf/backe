/**
 * Eine Datei, die niemand nimmt, öffnet der Browser selbst und verlässt dabei die App: Entwurf und
 * offener Dialog wären weg. Das trifft jede Stelle ohne Drop-Fläche (Kopfzeile, Tab-Leiste, ein
 * Dialog im Portal) und einen Editor, der nur Bilder nimmt. Der Wächter hört am Ende des
 * Bubble-Wegs auf `window`: Hat kein Editor und keine Drop-Fläche das Ereignis genommen
 * (`defaultPrevented`), nimmt er es und tut nichts damit. Wer selbst ablegen lässt, bleibt
 * unberührt.
 */

const carriesFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') === true;

/** Hängt den Wächter an `win`; liefert die Funktion, die ihn wieder abhängt. */
export function guardFileDrops(win: Window): () => void {
  const over = (e: DragEvent) => {
    if (e.defaultPrevented || !carriesFiles(e)) return;
    e.preventDefault();
    // Hier ist kein Ziel: Der Zeiger zeigt das, und ein `drop` folgt gar nicht erst.
    if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'none';
  };
  const drop = (e: DragEvent) => {
    if (!e.defaultPrevented && carriesFiles(e)) e.preventDefault();
  };
  win.addEventListener('dragover', over);
  win.addEventListener('drop', drop);
  return () => {
    win.removeEventListener('dragover', over);
    win.removeEventListener('drop', drop);
  };
}
