import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'threads',
    globals: true,
    environment: 'node',
    testTimeout: 30000
  }
});
