export class BrowserInfrastructureError extends Error {
  readonly retryable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BrowserInfrastructureError";
  }
}

export function isBrowserInfrastructureError(
  error: unknown,
): error is BrowserInfrastructureError {
  return error instanceof BrowserInfrastructureError;
}

export function isChromiumUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /executable doesn't exist/i.test(message) ||
    /browserType\.launch/i.test(message) ||
    /Failed to launch/i.test(message) ||
    /chromium.*not found/i.test(message)
  );
}
