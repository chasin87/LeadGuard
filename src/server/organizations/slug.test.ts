import { describe, expect, it } from "vitest";
import { nextSlugCandidate, slugifyOrganizationName } from "./slug";

describe("organization slugs", () => {
  it("slugifies a company name", () => {
    expect(slugifyOrganizationName("Voltios Energie")).toBe("voltios-energie");
  });

  it("avoids reserved slugs", () => {
    expect(slugifyOrganizationName("Settings")).toBe("organization");
    expect(slugifyOrganizationName("!!!")).toBe("organization");
  });

  it("builds collision candidates", () => {
    expect(nextSlugCandidate("voltios-energie", 0)).toBe("voltios-energie");
    expect(nextSlugCandidate("voltios-energie", 1)).toBe("voltios-energie-2");
  });
});
