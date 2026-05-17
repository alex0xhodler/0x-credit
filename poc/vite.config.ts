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
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
})
