import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';
import { alias } from './web/vite.config.ts';

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
  'src/tools/**': { lines: 90, branches: 85 },
  'src/mcp/**': { lines: 90, branches: 85 },
  'src/ui/**': { lines: 90, branches: 85 },
  'web/src/data/**': { lines: 90, branches: 85 },
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
      include: ['src/**', 'web/src/**'],
      // CLI-Code wird über E2E abgedeckt, nicht über Unit-Coverage; der MCP-Adapter läuft in den
      // Tests in-process über den In-Memory-Transport und zählt. Die shadcn-Vorlagen sind fremder
      // Code, `main.tsx` nur der Einstieg, der die App einhängt.
      exclude: [
        'src/cli/**',
        'src/**/*.test.ts',
        'web/src/**/*.test.{ts,tsx}',
        'web/src/components/ui/**',
        'web/src/main.tsx',
        'web/src/test/**',
      ],
      thresholds: sharded ? undefined : thresholds,
    },
    // Beide Projekte erben `env`, `setupFiles` und die Coverage von oben; `pnpm test` läuft beide.
    projects: [
      {
        extends: true,
        // Die Browser-E2E unter `test/browser/` laufen mit Playwright (`pnpm run test:e2e`).
        test: { name: 'node', exclude: [...configDefaults.exclude, 'web/**', 'test/browser/**'] },
      },
      {
        extends: true,
        plugins: [react()],
        resolve: { alias },
        test: { name: 'web', environment: 'jsdom', include: ['web/src/**/*.test.{ts,tsx}'] },
      },
    ],
  },
});
