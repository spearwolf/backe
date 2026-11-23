import { defineConfig } from 'vitest/config';

// Ein Shard sieht nur seinen Teil der Coverage und reißt jede Schwelle. Geprüft wird darum erst
// beim Zusammenführen der Blob-Reports (`vitest run --merge-reports --coverage`), das ohne
// `--shard` läuft.
const sharded = process.argv.some((arg) => arg.startsWith('--shard'));

const thresholds = {
  lines: 85,
  branches: 85,
  'src/core/**': { lines: 90, branches: 90 },
  'src/store/**': { lines: 90, branches: 90 },
  'src/ops/**': { lines: 90, branches: 90 },
  'src/context/**': { lines: 90, branches: 90 },
  'src/services/**': { lines: 90, branches: 90 },
  'src/mcp/**': { lines: 90, branches: 85 },
};

export default defineConfig({
  test: {
    globals: true,
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      // git liest `$XDG_CONFIG_HOME/git/{config,ignore,attributes}` auch neben GIT_CONFIG_GLOBAL;
      // ein Pfad unter /dev/null existiert nie.
      XDG_CONFIG_HOME: '/dev/null/xdg',
      NO_COLOR: '1',
      // Die Suite prüft die deutschen Texte; Englisch prüfen die Tests, die `setLocale('en')`
      // setzen, und die E2E-Tests, die `BACKE_LANG` im Kind-Env weglassen.
      BACKE_LANG: 'de',
    },
    setupFiles: ['test/setup-locale.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // CLI-Code wird über E2E abgedeckt, nicht über Unit-Coverage; der MCP-Adapter läuft in den
      // Tests in-process über den In-Memory-Transport und zählt.
      exclude: ['src/cli/**', 'src/**/*.test.ts'],
      thresholds: sharded ? undefined : thresholds,
    },
  },
});
