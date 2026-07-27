import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Domain tests are pure TypeScript and run anywhere.
    // Database tests need a PostgreSQL instance; globalSetup builds it.
    globalSetup: ['./tests/globalSetup.ts'],
    include: ['tests/**/*.test.ts'],
    // Database tests share one database, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
});
