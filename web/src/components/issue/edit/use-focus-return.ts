import { useCallback, useEffect, useRef } from 'react';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]';

const focusLost = (): boolean =>
  document.activeElement === null || document.activeElement === document.body;

/** Das Element mit `data-focus-return` im Bereich, sonst das erste bedienbare. */
function fallbackIn(root: HTMLElement): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>('[data-focus-return]:not([disabled])') ??
    root.querySelector<HTMLElement>(FOCUSABLE)
  );
}

/**
 * Hält den Fokus im Editor, wenn ein Write ihn verdrängt: Während `busy` sind die Bedienelemente
 * gesperrt (der Browser schiebt den Fokus dann auf `body`), ein entfernter Chip verschwindet ganz,
 * ein Menüeintrag schließt sein Menü. Steht der Fokus danach nirgends, kehrt er zum Auslöser
 * zurück, sonst zum Element mit `data-focus-return` im Bereich, sonst zum ersten bedienbaren.
 */
export function useFocusReturn<E extends HTMLElement>(busy: boolean) {
  const scope = useRef<E>(null);
  const origin = useRef<HTMLElement | null>(null);
  const capture = useCallback(() => {
    const active = document.activeElement;
    origin.current = active instanceof HTMLElement ? active : null;
  }, []);
  useEffect(() => {
    if (busy || origin.current === null) return;
    const from = origin.current;
    origin.current = null;
    const root = scope.current;
    if (!focusLost() || root === null) return;
    const target =
      from.isConnected && root.contains(from) && from.matches(FOCUSABLE) ? from : fallbackIn(root);
    target?.focus();
  }, [busy]);
  return { scope, capture };
}

/**
 * Für Listen, deren Einträge samt Editor verschwinden (eine entfernte Property): Verschwindet das
 * zuletzt fokussierte Element und steht der Fokus dann nirgends, fängt der Bereich ihn auf.
 */
export function useFocusRescue<E extends HTMLElement>() {
  const ref = useRef<E>(null);
  const last = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    const track = (e: FocusEvent) => {
      last.current = e.target instanceof HTMLElement ? e.target : null;
    };
    root.addEventListener('focusin', track);
    return () => root.removeEventListener('focusin', track);
  }, []);
  useEffect(() => {
    const root = ref.current;
    if (root === null || last.current === null || last.current.isConnected || !focusLost()) return;
    last.current = null;
    fallbackIn(root)?.focus();
  });
  return ref;
}
