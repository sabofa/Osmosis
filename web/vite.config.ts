import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The frontend has exactly one backend address (its local node's /api) and
// never learns whether the machine is online — that's the local backend's problem.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8081',
    },
  },
})
