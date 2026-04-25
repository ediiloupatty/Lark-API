import { defineConfig } from 'vitest/config';
import path from 'path';

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
    // Load .env.test instead of .env (sets NODE_ENV=test)
    env: {
      NODE_ENV: 'test',
    },
    // Dotenv: load .env.test first, fallback to .env
    envFile: path.resolve(__dirname, '.env.test'),
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/controllers/**', 'src/middlewares/**'],
      exclude: [
        'src/generated/**',
        'src/config/**',
        'node_modules/**',
        'tests/**',
      ],
      // Thresholds — fail if coverage drops below these values
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 40,
        statements: 50,
      },
    },
  },
});
