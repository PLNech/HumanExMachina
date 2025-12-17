import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../docs',
    emptyOutDir: false, // Keep existing files
  },
  server: {
    port: 3000,
  },
});
