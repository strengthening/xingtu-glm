/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
