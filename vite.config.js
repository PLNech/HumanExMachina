import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: '/HumanExMachina/', // GitHub Pages base path
  build: {
    outDir: '../docs',
    emptyOutDir: false, // Keep existing files
  },
  server: {
    port: 3000,
  },
});
