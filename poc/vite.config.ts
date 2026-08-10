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
      '/gearbox-apy': {
        target: 'https://state-cache.gearbox.foundation',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/gearbox-apy/, '/apy-server'),
      },
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
  },
})
