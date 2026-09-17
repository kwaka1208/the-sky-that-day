import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/the-sky-that-day/',
  plugins: [react()],
  build: {
    // The embedded 8k-star catalog compresses well but exceeds Vite's raw 500 kB threshold.
    chunkSizeWarningLimit: 600,
  },
});
