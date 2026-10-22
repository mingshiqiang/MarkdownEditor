import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'electron/**/*.test.ts'],
    globals: false,
    // `?inline` CSS imports (used by the export pipeline) must be processed.
    css: true
  }
})
