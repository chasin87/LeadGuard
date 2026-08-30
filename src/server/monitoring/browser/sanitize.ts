const maxMessageLength = 180;

export function sanitizeErrorMessage(value: string): string {
  return truncate(stripSecrets(value.replace(/\s+/g, " ").trim()));
}

export function sanitizeResourceUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return truncate(raw.split("?")[0] ?? raw, 120);
  }
}

function stripSecrets(value: string): string {
  return value
    .replace(
      /([?&](token|key|secret|password|auth|session|sig)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}

function truncate(value: string, max = maxMessageLength): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
