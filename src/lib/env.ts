import { z } from "zod";

const serverEnvironmentSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function parseServerEnvironment(values: NodeJS.ProcessEnv): ServerEnvironment {
  return serverEnvironmentSchema.parse(values);
}

let cachedEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  cachedEnvironment ??= parseServerEnvironment(process.env);
  return cachedEnvironment;
}
