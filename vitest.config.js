import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  mode: 'v4',
  define: {
    'import.meta.env.VITE_BACKEND_VERSION': JSON.stringify('v4'),
    'import.meta.env.MODE': JSON.stringify('v4'),
    'import.meta.env.DEV': JSON.stringify(true),
  },
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.spec.js'],
  },
})
