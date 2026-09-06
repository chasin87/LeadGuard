import {
  getNotificationQueue,
  stopNotificationQueue,
  type NotificationDeliveryJobData,
  type OutcomeImportJobData,
} from "@/jobs/queue";
import {
  getNotificationConfig,
  notificationDeliveryQueue,
} from "@/server/notifications/config";
import { outcomeImportQueue } from "@/server/outcomes/queue";
import { processOutcomeImport } from "@/server/outcomes/import-service";
import {
  dispatchPendingOutboxEvents,
  enqueueDueNotificationDeliveries,
} from "@/server/notifications/dispatcher";
import { processDelivery } from "@/server/notifications/delivery";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import { recordWorkerHeartbeat } from "@/server/ops/heartbeat";

const logger = createLogger("notification-worker");

let dispatcherTimer: NodeJS.Timeout | undefined;
let dispatching = false;
let shuttingDown = false;

async function dispatcherTick() {
  if (dispatching || shuttingDown) return;
  dispatching = true;
  try {
    const dispatched = await dispatchPendingOutboxEvents();
    const enqueued = await enqueueDueNotificationDeliveries();
    if (dispatched > 0 || enqueued > 0) {
      logger.info("notification.dispatcher.tick", { dispatched, enqueued });
    }
  } catch (error) {
    logger.error("notification.dispatcher.tick_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  } finally {
    dispatching = false;
  }
}

export async function startNotificationWorker(): Promise<void> {
  const config = getNotificationConfig();
  const queue = await getNotificationQueue();
  await queue.work<NotificationDeliveryJobData>(
    notificationDeliveryQueue,
    {
      localConcurrency: config.workerConcurrency,
      batchSize: 1,
    },
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      await processDelivery(job.data.deliveryId);
    },
  );
  await queue.work<OutcomeImportJobData>(
    outcomeImportQueue,
    {
      localConcurrency: 1,
      batchSize: 1,
    },
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      await processOutcomeImport(job.data.importId);
    },
  );
  dispatcherTimer = setInterval(() => {
    void dispatcherTick();
  }, config.dispatcherPollMs);
  logger.info("worker.started", {
    concurrency: config.workerConcurrency,
  });
  await recordWorkerHeartbeat("NOTIFICATION");
  void dispatcherTick();
}

export async function stopNotificationWorker(): Promise<void> {
  shuttingDown = true;
  if (dispatcherTimer) clearInterval(dispatcherTimer);
  while (dispatching) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await stopNotificationQueue();
  await database.$disconnect();
  logger.info("worker.stopped");
}
