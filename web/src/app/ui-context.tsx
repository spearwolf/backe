import { createSignal, type SignalReader } from '@spearwolf/signalize';
import { createContext, useContext } from 'react';
import { useSignal } from '../data/use-signal.ts';
import type { Theme } from './theme.ts';
import type { UiPrefs } from './ui-prefs.ts';

/** Was Settings und einzelne Ansichten von der Oberfläche brauchen; `App` stellt es bereit. */
export type UiAccess = { theme: Theme; prefs: UiPrefs };

export const UiContext = createContext<UiAccess | null>(null);

export function useUi(): UiAccess {
  const ui = useContext(UiContext);
  if (ui === null) throw new Error('useUi() needs a UiContext.Provider');
  return ui;
}

/** Die Einstellungen, falls eine App darüber steht; Prüfstände einzelner Ansichten haben keine. */
export function useUiPrefs(): UiPrefs | undefined {
  return useContext(UiContext)?.prefs;
}

// Ein Signal, das nie wechselt: `useSignal` braucht eine Quelle, auch ohne Provider.
const ALLOWED: SignalReader<boolean> = createSignal(true).get;

/** Ohne Provider true: Markdown in Tests und Dialogen zeigt Bilder wie bisher. */
export function useExternalImages(): boolean {
  return useSignal(useUiPrefs()?.externalImages.get ?? ALLOWED);
}
