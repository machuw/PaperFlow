import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, readdirSync } from 'fs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-static',
      writeBundle() {
        mkdirSync('dist', { recursive: true });
        copyFileSync('manifest.json', 'dist/manifest.json');
        copyFileSync('rules.json', 'dist/rules.json');
        mkdirSync('dist/icons', { recursive: true });
        for (const f of readdirSync('icons')) {
          if (f.endsWith('.png') || f.endsWith('.svg')) copyFileSync(`icons/${f}`, `dist/icons/${f}`);
        }
        // Phase 13 (BLOCKER-1 fix): bundle the wrapper-setup doc so the BYOK
        // chip popover banner link resolves to chrome-extension://<id>/docs/...
        mkdirSync('dist/docs', { recursive: true });
        const docsToBundle = ['2026-04-29-claude-code-via-litellm.md'];
        for (const f of docsToBundle) {
          copyFileSync(`../docs/${f}`, `dist/docs/${f}`);
        }
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        reader: resolve(__dirname, 'reader/index.html'),
        options: resolve(__dirname, 'options/index.html'),
        sw: resolve(__dirname, 'background/sw.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'sw') return 'background/sw.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
      },
    },
  },
});
