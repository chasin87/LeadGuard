export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function emailLayout(input: {
  preheader: string;
  title: string;
  rows: Array<{ label: string; value: string }>;
  footer?: string;
}): { html: string; text: string } {
  const rowsHtml = input.rows
    .map(
      (row) =>
        `<tr><td style="padding:8px 0;color:#64748b;vertical-align:top;width:140px;">${escapeHtml(row.label)}</td><td style="padding:8px 0;color:#0f172a;">${escapeHtml(row.value)}</td></tr>`,
    )
    .join("");
  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;">
  <span style="display:none;visibility:hidden;">${escapeHtml(input.preheader)}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;">
    <tr><td>
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#19d0a2;">LeadGuard</p>
      <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a;">${escapeHtml(input.title)}</h1>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rowsHtml}</table>
      ${input.footer ? `<p style="margin:20px 0 0;font-size:13px;color:#64748b;">${escapeHtml(input.footer)}</p>` : ""}
    </td></tr>
  </table>
</body>
</html>`;
  const text = [
    "LeadGuard",
    input.title,
    "",
    ...input.rows.map((row) => `${row.label}: ${row.value}`),
    ...(input.footer ? ["", input.footer] : []),
  ].join("\n");
  return { html, text };
}
