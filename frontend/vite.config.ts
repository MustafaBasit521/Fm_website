/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The SHOP site (customers). The admin site is a separate app: see vite.admin.config.ts.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist/shop', emptyOutDir: true },
  server: {
    port: 5173,
    // Dev only: forward /api to FastAPI so the browser sees a single origin.
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
  },
})
