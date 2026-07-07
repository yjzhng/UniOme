import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Relative asset URLs so the built bundle works wherever it's mounted (the desktop shell serves
  // it from the embedded server root; also fine for file:// or a sub-path static host).
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    // The launcher (UniOme.command) picks free ports and passes them in; fall back to the
    // conventional defaults for a bare `npm run dev`.
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: !!process.env.WEB_PORT,
    proxy: {
      '/api': process.env.VITE_API_TARGET ?? 'http://127.0.0.1:4000',
    },
  },
});
