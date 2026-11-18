import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { cli: 'src/cli/main.ts' },
  format: 'esm',
  platform: 'node',
  banner: '#!/usr/bin/env node',
  fixedExtension: false,
  clean: true,
});
