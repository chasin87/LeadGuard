import { describe, expect, it } from "vitest";
import { parseServerEnvironment } from "./env";

const validSecret = "a".repeat(32);

describe("server environment", () => {
  it("accepts a PostgreSQL connection and applies safe defaults", () => {
    expect(
      parseServerEnvironment({
        DATABASE_URL: "postgresql://user:password@localhost:5432/leadguard",
        AUTH_SECRET: validSecret,
      }),
    ).toMatchObject({ APP_URL: "http://localhost:3000", LOG_LEVEL: "info" });
  });

  it("treats empty SMTP settings as unset", () => {
    expect(
      parseServerEnvironment({
        DATABASE_URL: "postgresql://user:password@localhost:5432/leadguard",
        AUTH_SECRET: validSecret,
        SMTP_HOST: "",
        EMAIL_FROM: "",
      }),
    ).toMatchObject({ SMTP_HOST: undefined, EMAIL_FROM: undefined });
  });

  it("rejects non-PostgreSQL database URLs", () => {
    expect(() =>
      parseServerEnvironment({
        DATABASE_URL: "file:./local.db",
        AUTH_SECRET: validSecret,
      }),
    ).toThrow();
  });

  it("rejects a short AUTH_SECRET", () => {
    expect(() =>
      parseServerEnvironment({
        DATABASE_URL: "postgresql://user:password@localhost:5432/leadguard",
        AUTH_SECRET: "too-short",
      }),
    ).toThrow();
  });
});
