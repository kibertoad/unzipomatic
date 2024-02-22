import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    watch: false,
    environment: 'node',
    reporters: ['verbose'],
    coverage: {
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.spec.ts'],
      reporter: ['text'],
      all: true,
      // Disabling thresholds for now
      // thresholds: {
      //   lines: 100,
      //   functions: 100,
      //   branches: 100,
      //   statements: 100,
      // },
    },
  },
})
