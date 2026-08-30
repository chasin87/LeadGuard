import { describe, expect, it } from "vitest";
import { slugCandidate, slugifyOrganizationName } from "./slug";

describe("organization slugs", () => {
  it("normalizes company names", () => expect(slugifyOrganizationName("  Völtios Energie B.V. ")).toBe("voltios-energie-b-v"));
  it("creates deterministic collision candidates", () => {
    expect(slugCandidate("voltios-energie", 0)).toBe("voltios-energie");
    expect(slugCandidate("voltios-energie", 1)).toBe("voltios-energie-2");
  });
});
