import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],

  server: {
    // Required for Vite to bind to 0.0.0.0 inside Docker
    host: true,
    port: 5173,

    // Proxy /api requests to the Django backend.
    // - Inside Docker the service name "backend" resolves correctly.
    // - Outside Docker (plain npm run dev) set VITE_BACKEND_PROXY_TARGET
    //   in your .env, e.g. VITE_BACKEND_PROXY_TARGET=http://localhost:8000
    // This proxy is only active during development (vite dev server).
    // The browser always calls http://localhost:8000 via VITE_API_URL.
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
