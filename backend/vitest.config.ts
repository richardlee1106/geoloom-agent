import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    coverage: {
      enabled: false,
    },
  },
})

