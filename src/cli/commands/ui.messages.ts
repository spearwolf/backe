import { catalog } from '../../i18n/catalog.ts';

export const m = catalog({
  en: {
    description: 'Start the local web interface',
    portOption: 'Port to listen on (0 picks a free port)',
    openOption: 'Open the URL in the default browser',
    invalidPort: (value: string) =>
      `Invalid port: ${value}; expected a whole number from 0 to 65535`,
    openFailed: (cmd: string) =>
      `Could not open the browser with ${cmd}; open the URL above yourself`,
  },
  de: {
    description: 'lokale Web-Oberfläche starten',
    portOption: 'Port, auf dem gelauscht wird (0 wählt einen freien Port)',
    openOption: 'die URL im Standardbrowser öffnen',
    invalidPort: (value: string) =>
      `Ungültiger Port: ${value}; erwartet wird eine ganze Zahl von 0 bis 65535`,
    openFailed: (cmd: string) =>
      `Browser ließ sich mit ${cmd} nicht öffnen; die URL oben selbst öffnen`,
  },
});
