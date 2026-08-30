import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { getBrowserMonitoringConfig } from "@/server/monitoring/browser/config";
import {
  BrowserInfrastructureError,
  isChromiumUnavailableError,
} from "@/server/monitoring/browser/errors";
import { incrementBrowserMetric } from "@/server/monitoring/browser/metrics";
import { createLogger } from "@/server/logger";

const logger = createLogger("browser-worker");

type BrowserHolder = {
  browser: Browser;
  checks: number;
};

let holder: BrowserHolder | undefined;
let launchChain: Promise<void> = Promise.resolve();

function withLaunchLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = launchChain.then(fn, fn);
  launchChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function ensureBrowser(): Promise<Browser> {
  return withLaunchLock(async () => {
    const config = getBrowserMonitoringConfig();
    if (holder && holder.browser.isConnected()) {
      if (holder.checks >= config.recycleAfterChecks) {
        await closeBrowserUnlocked("recycle");
      } else {
        return holder.browser;
      }
    }
    holder = { browser: await launchBrowser(), checks: 0 };
    incrementBrowserMetric("browser_process_restarts");
    logger.info("browser.process.started", {
      recycleAfter: config.recycleAfterChecks,
      sandbox: config.chromiumSandbox,
    });
    return holder.browser;
  });
}

export async function noteBrowserCheckCompleted(): Promise<void> {
  await withLaunchLock(async () => {
    if (holder) holder.checks += 1;
  });
}

export async function restartBrowser(reason: string): Promise<void> {
  await withLaunchLock(async () => {
    await closeBrowserUnlocked(reason);
    holder = { browser: await launchBrowser(), checks: 0 };
    incrementBrowserMetric("browser_process_restarts");
    logger.warn("browser.process.restarted", { reason });
  });
}

export async function closeSharedBrowser(): Promise<void> {
  await withLaunchLock(async () => {
    await closeBrowserUnlocked("shutdown");
  });
}

export async function withIsolatedContext<T>(
  options: Parameters<Browser["newContext"]>[0],
  fn: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const browser = await ensureBrowser();
  if (!browser.isConnected()) {
    throw new BrowserInfrastructureError(
      "Chromium disconnected before the check.",
    );
  }
  const context = await browser.newContext({
    ...options,
    acceptDownloads: false,
    bypassCSP: false,
    javaScriptEnabled: true,
    serviceWorkers: "block",
    permissions: [],
  });
  try {
    return await fn(context);
  } finally {
    await context.close().catch(() => undefined);
    await noteBrowserCheckCompleted();
  }
}

async function launchBrowser(): Promise<Browser> {
  const config = getBrowserMonitoringConfig();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim();
  const args = [
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
  ];
  if (!config.chromiumSandbox) {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }
  try {
    const browser = await chromium.launch({
      headless: true,
      executablePath: executablePath || undefined,
      chromiumSandbox: config.chromiumSandbox,
      args,
    });
    browser.on("disconnected", () => {
      logger.warn("browser.process.disconnected", {});
      if (holder?.browser === browser) holder = undefined;
    });
    return browser;
  } catch (error) {
    if (isChromiumUnavailableError(error) || error instanceof Error) {
      throw new BrowserInfrastructureError(
        "Chromium is unavailable. This is a LeadGuard infrastructure problem, not a website outage.",
        { cause: error },
      );
    }
    throw new BrowserInfrastructureError(
      "Chromium is unavailable. This is a LeadGuard infrastructure problem, not a website outage.",
      { cause: error },
    );
  }
}

async function closeBrowserUnlocked(reason: string): Promise<void> {
  const current = holder;
  holder = undefined;
  if (!current) return;
  await current.browser.close().catch((error: unknown) => {
    logger.warn("browser.process.close_failed", {
      reason,
      message: error instanceof Error ? error.message : "unknown",
    });
  });
}
