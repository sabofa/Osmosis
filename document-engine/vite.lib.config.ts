// Library build config for publishing document-engine as a package consumable
// by both `web` (full DocumentViewer React component) and `server` (pure
// PDF-text-extraction core only, via the `document-engine/core` entry).
// Kept separate from vite.config.ts, which stays dedicated to the standalone
// demo app. Mirrors graph-engine/vite.lib.config.ts.
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import dts from 'vite-plugin-dts'

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.app.json',
      entryRoot: 'src',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/main.tsx', 'src/App.tsx'],
      outDir: 'dist',
      rollupTypes: false,
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: {
        index: resolve('src/index.ts'),
        'core/index': resolve('src/core/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      // pdfjs-dist is externalized (not bundled) so both `web` and `server`
      // resolve their own single copy via the workspace hoist rather than
      // shipping two separate bundled builds of a large library.
      external: ['react', 'react-dom', 'react/jsx-runtime', 'pdfjs-dist', /^pdfjs-dist\//],
    },
  },
})
