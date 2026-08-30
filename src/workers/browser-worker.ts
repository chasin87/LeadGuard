import { getMonitorQueue, stopMonitorQueue } from "@/jobs/queue";
import { browserCheckQueue } from "@/server/monitoring/browser/config";
import { formCheckQueue } from "@/server/monitoring/form/config";
import { getBrowserMonitoringConfig } from "@/server/monitoring/browser/config";
import { getFormMonitoringConfig } from "@/server/monitoring/form/config";
import {
  disconnectBrowserLocks,
  executeBrowserMonitorJob,
} from "@/server/monitoring/browser-runner";
import {
  disconnectFormLocks,
  executeFormMonitorJob,
} from "@/server/monitoring/form-runner";
import { closeSharedBrowser } from "@/server/monitoring/browser/session";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import type { FormCheckJobData, MonitorCheckJobData } from "@/jobs/queue";

const logger = createLogger("browser-worker");

export async function startBrowserWorker(): Promise<void> {
  const config = getBrowserMonitoringConfig();
  const formConfig = getFormMonitoringConfig();
  const queue = await getMonitorQueue();
  await queue.work<MonitorCheckJobData>(
    browserCheckQueue,
    {
      localConcurrency: config.workerConcurrency,
      batchSize: 1,
    },
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      await executeBrowserMonitorJob(job.data.monitorId, {
        jobId: job.id,
        signal: job.signal,
      });
    },
  );
  await queue.work<FormCheckJobData>(
    formCheckQueue,
    {
      localConcurrency: formConfig.workerConcurrency,
      batchSize: 1,
    },
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      await executeFormMonitorJob(job.data.monitorId, {
        jobId: job.id,
        mode: job.data.mode,
        source: job.data.source,
        signal: job.signal,
      });
    },
  );
  logger.info("worker.started", {
    concurrency: config.workerConcurrency,
    formConcurrency: formConfig.workerConcurrency,
  });
}

export async function stopBrowserWorker(): Promise<void> {
  await stopMonitorQueue();
  await closeSharedBrowser();
  await disconnectBrowserLocks();
  await disconnectFormLocks();
  await database.$disconnect();
  logger.info("worker.stopped");
}
