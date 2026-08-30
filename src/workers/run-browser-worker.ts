import {
  startBrowserWorker,
  stopBrowserWorker,
} from "@/workers/browser-worker";
import { createLogger } from "@/server/logger";

const logger = createLogger("browser-worker");

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("worker.shutdown", { signal });
  await stopBrowserWorker();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

startBrowserWorker().catch((error: unknown) => {
  logger.error("worker.fatal", {
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exit(1);
});
