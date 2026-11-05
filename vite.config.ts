import { defineConfig } from 'vite';

// base './' para que funcione en GitHub Pages o en cualquier subcarpeta
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 4000 },
});
