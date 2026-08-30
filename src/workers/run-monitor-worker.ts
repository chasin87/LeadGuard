import {
  startMonitorWorker,
  stopMonitorWorker,
} from "@/workers/monitor-worker";
import { createLogger } from "@/server/logger";

const logger = createLogger("monitor-worker");

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("worker.shutdown", { signal });
  await stopMonitorWorker();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

startMonitorWorker().catch((error: unknown) => {
  logger.error("worker.fatal", {
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exit(1);
});
