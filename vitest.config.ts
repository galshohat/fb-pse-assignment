import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests live next to the code they cover. Nothing here touches the network:
    // live verification is scripts/smoke.ts, run deliberately.
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
