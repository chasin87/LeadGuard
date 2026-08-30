import { scheduleDueMonitors } from "@/server/monitoring/scheduler";
import { getMonitoringConfig } from "@/server/monitoring/config";
import { stopMonitorQueue } from "@/jobs/queue";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";

const logger = createLogger("scheduler");
const config = getMonitoringConfig();

let running = false;
let shuttingDown = false;

async function tick() {
  if (running || shuttingDown) return;
  running = true;
  try {
    const enqueued = await scheduleDueMonitors();
    if (enqueued > 0) {
      logger.info("scheduler.tick", { enqueued });
    }
  } catch (error) {
    logger.error("scheduler.tick_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  } finally {
    running = false;
  }
}

const timer = setInterval(() => {
  void tick();
}, config.schedulerPollMs);

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("scheduler.shutdown", { signal });
  clearInterval(timer);
  while (running) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await stopMonitorQueue();
  await database.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

logger.info("scheduler.started", { pollMs: config.schedulerPollMs });
void tick();
