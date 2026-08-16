import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Every service in the workspace is configured from the one .env file at the
  // repository root. Without this, Vite would look only inside services/web and
  // VITE_API_URL would silently have no effect.
  envDir: '../../',
  server: {
    // `strictPort` is deliberate. The API allows exactly one browser origin, so
    // silently starting on 5174 would turn a busy port into a confusing CORS
    // failure. Failing to start is the clearer error.
    port: 5173,
    strictPort: true,
  },
  build: {
    // Source maps make the shipped bundle debuggable; there is nothing secret
    // in this client, since every credential lives on the server side.
    sourcemap: true,
  },
});
