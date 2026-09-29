/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Large generated star tiles live in public/data; keep dev server from
  // pre-bundling them (they are fetched at runtime with fetch()/ArrayBuffer).
  server: {
    fs: { allow: ['public'] },
  },
  build: {
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
