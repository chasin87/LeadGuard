import { config } from "dotenv";
import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

config({ path: ".env" });

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "server-only": path.resolve(root, "src/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    coverage: { reporter: ["text", "html"] },
    include: ["src/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
