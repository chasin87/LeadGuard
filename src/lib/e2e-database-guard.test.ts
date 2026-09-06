import { describe, expect, it } from "vitest";
import {
  assertSafeToResetE2eDatabase,
  isDedicatedE2eDatabaseName,
  parseDatabaseName,
  rewriteLocalLeadguardUrl,
} from "../../scripts/e2e-env";

describe("e2e database reset guard", () => {
  it("accepts dedicated e2e and test database names", () => {
    expect(isDedicatedE2eDatabaseName("leadguard_e2e")).toBe(true);
    expect(isDedicatedE2eDatabaseName("leadguard_test")).toBe(true);
    expect(isDedicatedE2eDatabaseName("app_e2e")).toBe(true);
    expect(isDedicatedE2eDatabaseName("leadguard")).toBe(false);
  });

  it("rewrites only the local default development database name", () => {
    expect(
      parseDatabaseName(
        rewriteLocalLeadguardUrl(
          "postgresql://leadguard:change-me@localhost:5432/leadguard?schema=public",
        ),
      ),
    ).toBe("leadguard_e2e");
    expect(
      parseDatabaseName(
        rewriteLocalLeadguardUrl(
          "postgresql://leadguard:change-me@localhost:5432/customers?schema=public",
        ),
      ),
    ).toBe("customers");
  });

  it("refuses to reset the development database even with the allow flag", () => {
    expect(() =>
      assertSafeToResetE2eDatabase(
        "postgresql://leadguard:change-me@localhost:5432/leadguard",
        { ALLOW_E2E_DB_RESET: "true" },
      ),
    ).toThrow(/dedicated test\/e2e database/);
  });

  it("requires an explicit allow flag before resetting an e2e database", () => {
    expect(() =>
      assertSafeToResetE2eDatabase(
        "postgresql://leadguard:change-me@localhost:5432/leadguard_e2e",
      ),
    ).toThrow(/ALLOW_E2E_DB_RESET/);
    expect(
      assertSafeToResetE2eDatabase(
        "postgresql://leadguard:change-me@localhost:5432/leadguard_e2e",
        { ALLOW_E2E_DB_RESET: "true" },
      ),
    ).toBe("leadguard_e2e");
  });
});
