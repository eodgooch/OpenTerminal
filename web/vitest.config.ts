import { defineConfig } from "vitest/config";

// Scoped to the pure-logic unit tests under lib/ only — the lightweight-charts
// imperative rendering and the React components are not practical to unit test
// here and aren't covered by this config.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
