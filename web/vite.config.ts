import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export const alias = {
  '@backe': fileURLToPath(new URL('../src', import.meta.url)),
  '@': fileURLToPath(new URL('./src', import.meta.url)),
};

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias },
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    // Das Budget prüft scripts/check-ui-build.ts am initialen Chunk (gzip). Über 500 kB liegen nur
    // der Einstieg (gzip im Budget) und der Lazy-Chunk von Mermaids ELK-Layout; die Standardwarnung
    // wäre Dauerrauschen.
    chunkSizeWarningLimit: 2048,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.BACKE_UI_PORT ?? 8002}`,
        changeOrigin: true,
      },
    },
  },
});
