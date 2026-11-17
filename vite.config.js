import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Two entries: the app (index.html) and Poolside's save module
// (src/poolside/sync.js → dist/poolside/sync.js, a FIXED name so the static
// Poolside page can import it; its shared chunks stay hashed in /assets).
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { main: 'index.html', 'poolside-sync': 'src/poolside/sync.js' },
      preserveEntrySignatures: 'exports-only',
      output: {
        entryFileNames: (chunk) => (chunk.name === 'poolside-sync' ? 'poolside/sync.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
