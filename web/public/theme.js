// Klassisches Skript, synchron vor jedem Stylesheet: Das Theme steht fest, bevor die Seite zum
// ersten Mal malt. Dieselbe Regel wie im Client: `light`/`dark` gelten, alles andere heißt System.
// Ein Speicher oder `matchMedia`, der wirft, darf die Seite nicht aufhalten.
(() => {
  let choice = 'system';
  try {
    const stored = localStorage.getItem('backe-ui-theme');
    if (stored === 'light' || stored === 'dark') choice = stored;
  } catch {
    // gesperrter Speicher: System
  }
  let theme = choice;
  if (theme === 'system') {
    let dark = false;
    try {
      dark = matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      // ohne `matchMedia`: hell
    }
    theme = dark ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();
