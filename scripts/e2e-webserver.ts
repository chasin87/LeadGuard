import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  applyE2eEnvironment,
  assertPortAvailable,
  e2ePort,
  e2eRepoRoot,
  loadE2eEnvironment,
} from "./e2e-env";

async function main() {
  const env = loadE2eEnvironment();
  applyE2eEnvironment(env);

  if (!fs.existsSync(path.join(e2eRepoRoot, ".next"))) {
    throw new Error(
      "E2E webserver requires a production build. Run npm run e2e:clean.",
    );
  }

  const port = Number(e2ePort(env));
  await assertPortAvailable(port);

  const nextBin = path.join(e2eRepoRoot, "node_modules", ".bin", "next");
  const child = spawn(
    nextBin,
    ["start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: e2eRepoRoot,
      env: { ...env, NODE_ENV: "production", PORT: String(port) },
      stdio: "inherit",
    },
  );

  if (!child.pid) {
    throw new Error("Failed to start the E2E Next.js server.");
  }

  let shuttingDown = false;

  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    if (child.pid) child.kill("SIGTERM");
    const timeout = setTimeout(() => {
      if (child.pid) child.kill("SIGKILL");
    }, 8_000);
    timeout.unref();
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      process.exit(0);
      return;
    }
    process.exit(code ?? (signal ? 1 : 0));
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
