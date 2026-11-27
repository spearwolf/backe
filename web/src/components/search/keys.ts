const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"]';

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

/** Genau einer von Meta/Ctrl, ohne Alt und Umschalt; unter einem offenen Dialog oder Menü nie. */
export function isSearchKey(e: KeyboardEvent): boolean {
  if (e.key.toLowerCase() !== 'k' || e.altKey || e.shiftKey || e.metaKey === e.ctrlKey)
    return false;
  return document.querySelector(OVERLAY) === null;
}
