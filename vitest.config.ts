import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

// The svelte plugin compiles `.svelte.ts` runes modules so they can be unit-tested headlessly;
// `conditions: ['browser']` makes svelte resolve to its client (runes) runtime even though
// Vitest runs in Node. The template ships no runes store yet — this keeps the seam ready.
export default defineConfig({
  plugins: [svelte({ configFile: fileURLToPath(new URL('./svelte.config.ts', import.meta.url)) })],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    ...(process.env.VITEST ? { conditions: ['browser'] } : {}),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
    // The only unit spec is the strippable example (removed by `npm run remove-example-files`
    // alongside ExampleApp). Stay green afterwards until you add your own specs.
    passWithNoTests: true,
  },
});
