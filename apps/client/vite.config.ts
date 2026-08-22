import { defineConfig } from 'vite';

/**
 * The Phase 1 client is still plain ES modules with no framework and no
 * bundler-specific syntax, so Vite serves it as-is. `index.html` is the entry;
 * `src/main.js` is pulled in by its <script type="module"> tag.
 */
export default defineConfig({
  // root defaults to this config file's directory (apps/client).
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
