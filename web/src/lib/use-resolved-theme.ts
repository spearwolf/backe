import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

const read = (): 'light' | 'dark' =>
  document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

/** Aufgelöstes Theme: liest `data-theme` von `<html>` (gesetzt von `Theme`) und folgt ihm. */
export function useResolvedTheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, read, () => 'light');
}
