import {
  startNotificationWorker,
  stopNotificationWorker,
} from "@/workers/notification-worker";
import { createLogger } from "@/server/logger";

const logger = createLogger("notification-worker");

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("worker.shutdown", { signal });
  await stopNotificationWorker();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

startNotificationWorker().catch((error: unknown) => {
  logger.error("worker.fatal", {
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exit(1);
});
