import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Separate from vite.config.js on purpose: the Tailwind Vite plugin and the
// dev-server proxy have nothing to do with running unit tests, and pulling
// them in only slows Vitest down / adds failure modes unrelated to test code.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
});
