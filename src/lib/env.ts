import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.string().min(1).optional(),
);

const optionalPort = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.coerce.number().int().min(1).max(65535).optional(),
);

const serverEnvironmentSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters."),
  AUTH_TRUST_HOST: z.enum(["true", "false"]).optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SMTP_HOST: optionalNonEmptyString,
  SMTP_PORT: optionalPort,
  SMTP_SECURE: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.enum(["true", "false"]).optional(),
  ),
  SMTP_USER: optionalNonEmptyString,
  SMTP_PASSWORD: optionalNonEmptyString,
  EMAIL_FROM: optionalNonEmptyString,
  GOOGLE_ADS_PROVIDER: z.enum(["fake", "google"]).optional(),
  GOOGLE_ADS_CLIENT_ID: optionalNonEmptyString,
  GOOGLE_ADS_CLIENT_SECRET: optionalNonEmptyString,
  GOOGLE_ADS_DEVELOPER_TOKEN: optionalNonEmptyString,
  GOOGLE_ADS_REDIRECT_URI: optionalNonEmptyString,
  CREDENTIAL_ENCRYPTION_KEY: optionalNonEmptyString,
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function parseServerEnvironment(
  values: Record<string, string | undefined>,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(values);
}

let cachedEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  cachedEnvironment ??= parseServerEnvironment(process.env);
  return cachedEnvironment;
}
