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
});
