import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Polotno pulls in a large dependency tree. Raising the warning limit keeps
    // the build log readable; it does not change the output.
    chunkSizeWarningLimit: 4000,
  },
});
