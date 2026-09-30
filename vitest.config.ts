import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['tests/**/*.test.{ts,tsx}'],
      exclude: ['tests/e2e/**'],
      clearMocks: true,
    },
  }),
);
