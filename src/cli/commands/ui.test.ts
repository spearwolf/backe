import { setLocale } from '../../i18n/locale.ts';
import { openBrowser } from './ui.ts';

test('without a browser starter --open only hints, naming no command', () => {
  const out: string[] = [];
  openBrowser('http://127.0.0.1:1/?token=x', (s) => out.push(s), 'win32');
  expect(out.join('')).toContain('Auf dieser Plattform öffnet backe keinen Browser');
  expect(out.join('')).not.toMatch(/\bopen\b|xdg-open/);
});

test('the hint without a browser starter reads in English', () => {
  setLocale('en');
  try {
    const out: string[] = [];
    openBrowser('http://127.0.0.1:1/?token=x', (s) => out.push(s), 'win32');
    expect(out.join('')).toContain('Opening the browser is not supported on this platform');
  } finally {
    setLocale('de');
  }
});
