import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],

  build: {
    rollupOptions: {
      output: {
        // SYSPCC-036: stable vendors in their own chunks. They change far less
        // often than app code, so the browser keeps them cached across deploys.
        // lucide-react goes in one chunk: each icon is ~0.3 kB, but left alone
        // Rollup emits one tiny file per icon shared between screens (a hundred
        // extra requests). exceljs is NOT forced: it is reached only through
        // import() in utils/exportRQ.js and keeps its own lazy chunk.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/lucide-react/')) return 'vendor-icons';
          if (/node_modules\/(axios|follow-redirects|form-data|proxy-from-env)\//.test(id)) {
            return 'vendor-http';
          }
          return undefined;
        },
      },
    },
  },

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
      '/media': {
        target: process.env.VITE_BACKEND_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
