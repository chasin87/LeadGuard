import { describe, expect, it } from "vitest";
import { parseServerEnvironment } from "./env";

describe("server environment", () => {
  it("accepts a PostgreSQL connection and applies safe defaults", () => {
    expect(parseServerEnvironment({ DATABASE_URL: "postgresql://user:password@localhost:5432/leadguard" })).toMatchObject({ APP_URL: "http://localhost:3000", LOG_LEVEL: "info" });
  });

  it("rejects non-PostgreSQL database URLs", () => {
    expect(() => parseServerEnvironment({ DATABASE_URL: "file:./local.db" })).toThrow();
  });
});
