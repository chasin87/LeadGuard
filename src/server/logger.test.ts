import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger";

afterEach(() => vi.restoreAllMocks());

describe("logger", () => {
  it("redacts sensitive context fields", () => {
    const output = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    createLogger("test").info("message", {
      jobId: "job-1",
      password: "unsafe",
      refreshToken: "1//secret",
      developerToken: "dev-token",
    });
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('"password":"[REDACTED]"'),
    );
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('"refreshToken":"[REDACTED]"'),
    );
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('"developerToken":"[REDACTED]"'),
    );
    expect(output).toHaveBeenCalledWith(expect.not.stringContaining("unsafe"));
    expect(output).toHaveBeenCalledWith(
      expect.not.stringContaining("1//secret"),
    );
  });

  it("redacts raw click IDs but keeps presence flags", () => {
    const output = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    createLogger("test").info("tracking.attribution.created", {
      hasGclid: true,
      gclid: "SECRETCLICK",
    });
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('"hasGclid":true'),
    );
    expect(output).toHaveBeenCalledWith(
      expect.not.stringContaining("SECRETCLICK"),
    );
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('"gclid":"[REDACTED]"'),
    );
  });

  it("redacts revenue amounts but keeps hasRevenue and currency", () => {
    const output = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    createLogger("test").info("lead.revenue.changed", {
      hasRevenue: true,
      currency: "EUR",
      revenue: "4500.00",
      amountMinor: "450000",
    });
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('"hasRevenue":true'),
    );
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('"currency":"EUR"'),
    );
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('"revenue":"[REDACTED]"'),
    );
    expect(output).toHaveBeenCalledWith(expect.not.stringContaining("4500.00"));
  });
});
