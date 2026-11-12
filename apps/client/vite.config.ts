import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // host: true makes the dev server reachable from other machines on the network.
  // In development the page comes from Vite and the game server runs beside it:
  // connections to /ws are passed through to it.
  server: { host: true, port: 5173, proxy: { '/ws': { target: 'ws://localhost:3001', ws: true } } },
  preview: { host: true, port: 4173, proxy: { '/ws': { target: 'ws://localhost:3001', ws: true } } },
  build: { chunkSizeWarningLimit: 2000 },
});
