import { getMonitorQueue, stopMonitorQueue } from "@/jobs/queue";
import {
  getMonitoringConfig,
  monitorCheckQueue,
} from "@/server/monitoring/config";
import {
  disconnectMonitorLocks,
  executeMonitorJob,
} from "@/server/monitoring/runner";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import type { MonitorCheckJobData } from "@/jobs/queue";
import { recordWorkerHeartbeat } from "@/server/ops/heartbeat";

const logger = createLogger("monitor-worker");

export async function startMonitorWorker(): Promise<void> {
  const config = getMonitoringConfig();
  const queue = await getMonitorQueue();
  await queue.work<MonitorCheckJobData>(
    monitorCheckQueue,
    {
      localConcurrency: config.workerConcurrency,
      groupConcurrency: config.maxHostConcurrency,
      batchSize: 1,
    },
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      await recordWorkerHeartbeat("HTTP");
      await executeMonitorJob(job.data.monitorId, {
        jobId: job.id,
        signal: job.signal,
      });
    },
  );
  logger.info("worker.started", {
    concurrency: config.workerConcurrency,
  });
  await recordWorkerHeartbeat("HTTP");
}

export async function stopMonitorWorker(): Promise<void> {
  await stopMonitorQueue();
  await disconnectMonitorLocks();
  await database.$disconnect();
  logger.info("worker.stopped");
}
