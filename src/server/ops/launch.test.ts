import { describe, expect, it } from "vitest";
import { evaluateLaunchReadiness, launchReadinessFailed } from "./launch";

describe("launch readiness", () => {
  it("fails production when Stripe and auth secrets are missing", () => {
    const items = evaluateLaunchReadiness({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://leadguard:x@localhost:5432/leadguard",
      AUTH_SECRET: "replace-with-at-least-32-random-characters",
      APP_URL: "http://localhost:3000",
      BILLING_PROVIDER: "stripe",
    });
    expect(launchReadinessFailed(items)).toBe(true);
    expect(items.find((item) => item.id === "app_url")?.ok).toBe(false);
    expect(items.find((item) => item.id === "auth_secret")?.ok).toBe(false);
    expect(items.find((item) => item.id === "stripe_secret")?.ok).toBe(false);
  });

  it("rejects fake billing in production", () => {
    const items = evaluateLaunchReadiness({
      NODE_ENV: "production",
      E2E_RUNTIME: undefined,
      DATABASE_URL: "postgresql://leadguard:x@localhost:5432/leadguard",
      AUTH_SECRET: "a".repeat(32),
      APP_URL: "https://app.leadguard.example",
      BILLING_PROVIDER: "fake",
      CREDENTIAL_ENCRYPTION_KEY: "a".repeat(64),
      SMTP_HOST: "smtp.example.com",
      EMAIL_FROM: "LeadGuard <alerts@example.com>",
      ARTIFACT_STORAGE_DRIVER: "s3",
      GOOGLE_ADS_PROVIDER: "google",
      GOOGLE_ADS_CLIENT_ID: "id",
      GOOGLE_ADS_CLIENT_SECRET: "secret",
      GOOGLE_ADS_DEVELOPER_TOKEN: "token",
    });
    expect(items.find((item) => item.id === "billing_provider")?.ok).toBe(
      false,
    );
  });
});
