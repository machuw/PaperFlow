import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,  // main build cleared; don't re-clear
    lib: {
      entry: resolve(__dirname, 'content/inject.ts'),
      name: 'PaperFlowInject',
      formats: ['iife'],
      fileName: () => 'content/inject.js',
    },
    rollupOptions: {
      // inject.ts is self-contained; no externals.
      output: {
        extend: true,
      },
    },
  },
});
