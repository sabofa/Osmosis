// Library build config for publishing graph-engine as a package consumable
// by both `web` (full GraphViewer React component) and `server` (pure
// parser only, via the `graph-engine/parser` entry). Kept separate from
// vite.config.ts, which stays dedicated to the standalone demo app.
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
        'parser/index': resolve('src/parser/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'three', 'react/jsx-runtime'],
    },
  },
})
