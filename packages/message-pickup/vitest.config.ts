import wasm from 'vite-plugin-wasm';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [wasm()],
  test: {
    globals: true, // Enable global test functions
    setupFiles: ['vitest.setup.ts'],
    server: {
      deps: {
        inline: [/\.wasm$/],
      },
    },
  },
});
