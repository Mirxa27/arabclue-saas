import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    // .tsx tests render components; they opt into a DOM per file with
    // `// @vitest-environment jsdom` (jsdom + @testing-library/react are dev-only deps).
    include: ["__tests__/**/*.test.{ts,tsx}"],
    globals: true
  },
  // tsconfig keeps `"jsx": "preserve"` for Next's own compiler; tests need the JSX compiled,
  // with React 17+'s automatic runtime (no `import React` in components).
  oxc: {
    jsx: { runtime: "automatic", importSource: "react" }
  },
  resolve: {
    alias: { "@": root }
  }
});
