import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'dist/',
        'coverage/',
        'vitest.config.js',
        'vite.config.js'
      ]
    }
  },
  resolve: {
    alias: {
      '@': new URL('./js', import.meta.url).pathname
    }
  }
});
