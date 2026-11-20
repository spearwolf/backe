import { defineConfig } from 'vitest/config';

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
    },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // CLI-Code wird über E2E abgedeckt, nicht über Unit-Coverage; der MCP-Adapter läuft in den
      // Tests in-process über den In-Memory-Transport und zählt.
      exclude: ['src/cli/**', 'src/**/*.test.ts'],
      thresholds: {
        lines: 85,
        branches: 85,
        'src/core/**': { lines: 90, branches: 90 },
        'src/store/**': { lines: 90, branches: 90 },
        'src/ops/**': { lines: 90, branches: 90 },
        'src/context/**': { lines: 90, branches: 90 },
        'src/services/**': { lines: 90, branches: 90 },
        'src/mcp/**': { lines: 90, branches: 85 },
      },
    },
  },
});
