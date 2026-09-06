import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name: string) => path.join(root, "node_modules", ".bin", name);

type Service = {
  name: string;
  color: string;
  command: string;
  args: string[];
};

const services: Service[] = [
  { name: "web", color: "36", command: bin("next"), args: ["dev"] },
  {
    name: "scheduler",
    color: "33",
    command: bin("tsx"),
    args: ["--env-file=.env", "src/workers/run-scheduler.ts"],
  },
  {
    name: "worker",
    color: "32",
    command: bin("tsx"),
    args: ["--env-file=.env", "src/workers/run-monitor-worker.ts"],
  },
  {
    name: "browser",
    color: "35",
    command: bin("tsx"),
    args: ["--env-file=.env", "src/workers/run-browser-worker.ts"],
  },
  {
    name: "notifications",
    color: "34",
    command: bin("tsx"),
    args: ["--env-file=.env", "src/workers/run-notification-worker.ts"],
  },
  {
    name: "google-ads",
    color: "90",
    command: bin("tsx"),
    args: ["--env-file=.env", "src/workers/run-google-ads-worker.ts"],
  },
];

const children = new Map<string, ChildProcess>();
let shuttingDown = false;
const width = Math.max(...services.map((service) => service.name.length));

function prefix(name: string, color: string, chunk: string, leftover: string) {
  const text = leftover + chunk.replace(/\r/g, "");
  const lines = text.split("\n");
  const nextLeftover = lines.pop() ?? "";
  const label = `[${name.padEnd(width)}]`;
  for (const line of lines) {
    process.stdout.write(`\x1b[${color}m${label}\x1b[0m ${line}\n`);
  }
  return nextLeftover;
}

function start(service: Service) {
  const child = spawn(service.command, service.args, {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.set(service.name, child);

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout = prefix(
      service.name,
      service.color,
      chunk.toString("utf8"),
      stdout,
    );
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = prefix(
      service.name,
      service.color,
      chunk.toString("utf8"),
      stderr,
    );
  });
  child.on("exit", (code, signal) => {
    children.delete(service.name);
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    process.stderr.write(
      `\x1b[31m[${service.name.padEnd(width)}]\x1b[0m stopped (${reason})\n`,
    );
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write("\nStopping LeadGuard processes…\n");
  for (const child of children.values()) {
    if (child.pid) child.kill("SIGTERM");
  }
  const timeout = setTimeout(() => {
    for (const child of children.values()) {
      if (child.pid) child.kill("SIGKILL");
    }
    process.exit(1);
  }, 8_000);
  timeout.unref();

  const check = setInterval(() => {
    if (children.size === 0) {
      clearInterval(check);
      process.exit(0);
    }
  }, 50);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.stdout.write(
  "Starting web, scheduler, HTTP worker, browser worker, notifications and Google Ads.\nCtrl+C stops all processes.\n\n",
);
for (const service of services) start(service);
