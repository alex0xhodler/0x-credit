import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': {},
  },
  server: {
    proxy: {
      '/t54-api': {
        target: 'https://api.trustline.t54.ai',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/t54-api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    // Full-suite runs render several React trees with recharts effects; under
    // worker contention that can comfortably exceed the 5s default, even
    // though each test resolves in well under 1s in isolation.
    testTimeout: 10_000,
  },
})
