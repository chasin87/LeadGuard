export function maskEmailAddress(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return "***";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}

export function displayWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "webhook";
  }
}

export function webhookHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function sanitizePublicErrorMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .replace(/lgwh_[a-z0-9]+/gi, "[secret]")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 200);
}

export function sanitizeHeaderValue(value: string, maxLength = 180): string {
  return value
    .replace(/[\r\n\0]+/g, " ")
    .trim()
    .slice(0, maxLength);
}
