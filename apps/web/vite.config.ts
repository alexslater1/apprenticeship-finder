import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GitHub Pages serves the project at /apprenticeship-finder/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/apprenticeship-finder/' : '/',
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
}));
