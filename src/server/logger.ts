type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

const severity: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const secretKey =
  /authorization|cookie|password|secret|token|database_url|smtp|emailaddress|webhookurl|encrypt|credential|developer|clickid|sitekey|signature|bearertoken/i;
const clickIdKey = /^(gclid|gbraid|wbraid)$/i;
const moneyKey =
  /^(revenue|amount|amountminor|revenueamountminor|beforerevenueamountminor|afterrevenueamountminor)$/i;

function shouldRedact(key: string): boolean {
  if (/^has(Gclid|Gbraid|Wbraid|Revenue|Value)$/i.test(key)) return false;
  return secretKey.test(key) || clickIdKey.test(key) || moneyKey.test(key);
}

function sanitize(context: LogContext): LogContext {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      shouldRedact(key) ? "[REDACTED]" : value,
    ]),
  );
}

export function createLogger(
  component: string,
  configuredLevel: LogLevel = "info",
) {
  function write(level: LogLevel, message: string, context: LogContext = {}) {
    if (severity[level] < severity[configuredLevel]) return;
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      ...sanitize(context),
    });
    const output =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : console.info;
    output(record);
  }

  return {
    debug: (message: string, context?: LogContext) =>
      write("debug", message, context),
    info: (message: string, context?: LogContext) =>
      write("info", message, context),
    warn: (message: string, context?: LogContext) =>
      write("warn", message, context),
    error: (message: string, context?: LogContext) =>
      write("error", message, context),
  };
}
