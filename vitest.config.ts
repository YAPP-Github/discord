import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: [
        "src/services/**",
        "src/http/**",
        "src/utils/**",
        "src/db/repositories/**",
        "src/events/**",
        "src/commands/**",
      ],
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/types/**"],
    },
  },
});
