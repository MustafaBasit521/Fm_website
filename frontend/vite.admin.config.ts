import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The ADMIN site: a separate app with its own origin (own port in development, own domain in
// production), so the shop and its visitors can never read the admin's login session, and the
// admin code is not shipped to shoppers. It shares the code in src/ (api client, auth, ui).
export default defineConfig({
  root: 'admin',
  envDir: '..', // read VITE_* values from frontend/.env like the shop does
  publicDir: '../public',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/admin', emptyOutDir: true },
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:8000' },
  },
})
