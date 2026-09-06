import { config as loadDotenv } from "dotenv";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const e2eRepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const DEFAULT_E2E_PORT = "3015";

const blockedDatabaseNames = new Set([
  "leadguard",
  "postgres",
  "template0",
  "template1",
]);

export function e2ePort(env: NodeJS.Dict<string> = process.env): string {
  return env.PLAYWRIGHT_PORT || DEFAULT_E2E_PORT;
}

export function parseDatabaseName(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  return (
    decodeURIComponent(parsed.pathname.replace(/^\//, "")).split("/")[0] ?? ""
  );
}

export function isDedicatedE2eDatabaseName(name: string): boolean {
  return (
    /leadguard_test/i.test(name) ||
    /leadguard_e2e/i.test(name) ||
    /(_test|_e2e)$/i.test(name)
  );
}

export function rewriteLocalLeadguardUrl(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  if (parseDatabaseName(databaseUrl) === "leadguard") {
    parsed.pathname = "/leadguard_e2e";
    return parsed.toString();
  }
  return databaseUrl;
}

export function assertSafeToResetE2eDatabase(
  databaseUrl: string,
  env: NodeJS.Dict<string> = process.env,
): string {
  if (env.ALLOW_E2E_DB_RESET !== "true") {
    throw new Error(
      "Refusing E2E database reset: ALLOW_E2E_DB_RESET=true is required.",
    );
  }
  const name = parseDatabaseName(databaseUrl);
  if (!name) {
    throw new Error(
      "Refusing E2E database reset: DATABASE_URL has no database name.",
    );
  }
  if (blockedDatabaseNames.has(name) || !isDedicatedE2eDatabaseName(name)) {
    throw new Error(
      `Refusing E2E database reset: database "${name}" is not a dedicated test/e2e database. Use leadguard_e2e or a name containing leadguard_test.`,
    );
  }
  return name;
}

export function loadE2eEnvironment(): NodeJS.ProcessEnv {
  loadDotenv({ path: path.join(e2eRepoRoot, ".env") });
  const overlay = path.join(e2eRepoRoot, ".env.e2e");
  if (fs.existsSync(overlay)) {
    loadDotenv({ path: overlay, override: true });
  }

  const port = e2ePort(process.env);
  const origin = `http://127.0.0.1:${port}`;
  const fromExplicit = process.env.E2E_DATABASE_URL?.trim();
  const current = process.env.DATABASE_URL?.trim();
  if (!fromExplicit && !current) {
    throw new Error("E2E requires DATABASE_URL or E2E_DATABASE_URL.");
  }
  const databaseUrl = fromExplicit || rewriteLocalLeadguardUrl(current!);
  const name = parseDatabaseName(databaseUrl);
  if (!isDedicatedE2eDatabaseName(name)) {
    throw new Error(
      `E2E DATABASE_URL must point at a dedicated test database, received "${name}". Set E2E_DATABASE_URL.`,
    );
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    APP_URL: origin,
    AUTH_URL: origin,
    PLAYWRIGHT_PORT: port,
    PLAYWRIGHT_BASE_URL: origin,
    ALLOW_E2E_DB_RESET: "true",
    E2E_RATE_LIMIT_ISOLATION: "true",
    E2E_RUNTIME: "true",
    GOOGLE_ADS_PROVIDER: "fake",
    BILLING_PROVIDER: "fake",
    STRIPE_PRICE_STARTER_MONTHLY: "price_fake_starter",
    STRIPE_PRICE_GROWTH_MONTHLY: "price_fake_growth",
    STRIPE_PRICE_PRO_MONTHLY: "price_fake_pro",
    STRIPE_PRICE_AGENCY_MONTHLY: "price_fake_agency",
    AUTH_TRUST_HOST: "true",
    LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
  };
  delete env.SMTP_HOST;
  delete env.SMTP_PORT;
  delete env.SMTP_USER;
  delete env.SMTP_PASSWORD;
  env.E2E_RUN_ID = env.E2E_RUN_ID || crypto.randomUUID();
  return env;
}

export function applyE2eEnvironment(env: NodeJS.ProcessEnv): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

export async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `E2E port ${port} is already in use. Stop the process that owns it; Playwright will not reuse a stale Next server.`,
          ),
        );
        return;
      }
      reject(error);
    });
    server.once("listening", () => {
      server.close(() => resolve());
    });
    server.listen(port, "127.0.0.1");
  });
}

function adminUrlFor(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  parsed.pathname = "/postgres";
  return parsed.toString();
}

function databaseUser(databaseUrl: string): string {
  const user = decodeURIComponent(new URL(databaseUrl).username);
  if (!/^[a-zA-Z0-9_]+$/.test(user)) {
    throw new Error("Unsafe E2E database user.");
  }
  return user;
}

async function runLocalPsql(database: string, sql: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  await execFileAsync(
    "psql",
    ["-d", database, "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      timeout: 15_000,
    },
  );
}

async function transferPublicSchema(databaseUrl: string): Promise<void> {
  const name = parseDatabaseName(databaseUrl);
  const user = databaseUser(databaseUrl);
  try {
    await runLocalPsql(
      name,
      `ALTER SCHEMA public OWNER TO ${user}; GRANT ALL ON SCHEMA public TO ${user};`,
    );
  } catch {
    const admin = new pg.Client({ connectionString: adminUrlFor(databaseUrl) });
    try {
      await admin.connect();
      await admin.end();
    } catch {
      // Ownership transfer is best-effort; reset will fail loudly if it is still wrong.
    }
  }
}

export async function ensureE2eDatabase(databaseUrl: string): Promise<void> {
  const name = parseDatabaseName(databaseUrl);
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`Unsafe E2E database name "${name}".`);
  }
  const user = databaseUser(databaseUrl);

  const candidates = [
    adminUrlFor(databaseUrl),
    (() => {
      const fallback = new URL(databaseUrl);
      fallback.pathname = "/leadguard";
      return fallback.toString();
    })(),
  ];

  let lastError: unknown;
  for (const connectionString of candidates) {
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      const found = await client.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [name],
      );
      if (found.rowCount === 0) {
        await client.query(`CREATE DATABASE ${name} OWNER ${user}`);
      }
      await client.end();
      await transferPublicSchema(databaseUrl);
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
    }
  }

  try {
    await runLocalPsql("postgres", `CREATE DATABASE ${name} OWNER ${user}`);
  } catch {
    // Database already exists, or this OS user cannot create it.
  }
  await transferPublicSchema(databaseUrl);
  const probe = new pg.Client({ connectionString: databaseUrl });
  try {
    await probe.connect();
    await probe.end();
    return;
  } catch {
    await probe.end().catch(() => undefined);
  }

  throw new Error(
    `Could not create E2E database "${name}". Create it once as a superuser: CREATE DATABASE ${name} OWNER ${user}; ALTER SCHEMA public OWNER TO ${user}; Last error: ${String(lastError)}`,
  );
}

export async function resetE2eDatabase(
  databaseUrl: string,
  env: NodeJS.Dict<string> = process.env,
): Promise<void> {
  assertSafeToResetE2eDatabase(databaseUrl, env);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO PUBLIC");
    await client.query("GRANT ALL ON SCHEMA public TO CURRENT_USER");
  } finally {
    await client.end();
  }
}
