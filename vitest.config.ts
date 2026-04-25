import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    // Run test files sequentially to avoid DB race conditions
    fileParallelism: false,
    include: ['tests/**/*.test.ts'],
  },
});
