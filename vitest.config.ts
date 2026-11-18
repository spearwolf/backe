import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', NO_COLOR: '1' },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Adapter-Code (CLI, MCP) wird über E2E abgedeckt, nicht über Unit-Coverage.
      exclude: ['src/cli/**', 'src/mcp/**', 'src/**/*.test.ts'],
      thresholds: { lines: 85, branches: 85 },
    },
  },
});
