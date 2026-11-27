import { useRef } from 'react';

/**
 * Fokus nach dem Schließen eines Dialogs der Settings. `ConfirmDialog` gibt ihn allein nur an das
 * Element zurück, das beim Öffnen fokussiert war, und nur, solange es noch dasteht. Die Abschnitte
 * brauchen mehr: Der Auslöser kann mit der Aktion verschwinden, und dann soll der Fokus an einen
 * festen Ort statt auf `body`. Darum merkt sich der Abschnitt den Auslöser beim Öffnen (`opened`)
 * und gibt den Fokus selbst zurück.
 *
 * Verschwindet der Auslöser mit der Aktion (Entfernen, Verschieben, Schließen), geht der Fokus an
 * `fallbackId`, meist »Hinzufügen«. Die Marke dafür steht schon vor dem Write (`arm(true)`): Kommt
 * der Patch vor der Antwort, verschwindet der Dialog mit seinem Eintrag sofort, und Radix ruft
 * `onCloseAutoFocus` schon beim Unmount. Ein gescheiterter Write nimmt sie zurück (`arm(false)`).
 * Jedes Schließen verbraucht Marke und Auslöser; der nächste Dialog beginnt ohne beides.
 */
export function useDialogFocus(fallbackId: string) {
  const armed = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  return {
    opened: (from: HTMLElement | null): void => {
      trigger.current = from;
      armed.current = false;
    },
    arm: (on: boolean): void => {
      armed.current = on;
    },
    onCloseAutoFocus: (event: Event): void => {
      event.preventDefault();
      const from = trigger.current;
      const vanished = armed.current;
      trigger.current = null;
      armed.current = false;
      const target = !vanished && from?.isConnected ? from : document.getElementById(fallbackId);
      target?.focus();
    },
  };
}

export type DialogFocus = ReturnType<typeof useDialogFocus>;
