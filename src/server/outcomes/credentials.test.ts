import { describe, expect, it } from "vitest";
import { cellLooksLikeFormula, detectCsvDelimiter, parseCsvText } from "./csv";
import { mutationIdForExternalEvent } from "./mutation-id";
import {
  generateOutcomeIntegrationCredential,
  hashOutcomeSecret,
  isOutcomeIntegrationCredential,
  outcomeSecretsMatch,
} from "./credentials";

describe("outcome credentials", () => {
  it("generates high-entropy hashed credentials", () => {
    const secret = generateOutcomeIntegrationCredential();
    expect(isOutcomeIntegrationCredential(secret)).toBe(true);
    const hash = hashOutcomeSecret(secret);
    expect(hash).toHaveLength(64);
    expect(outcomeSecretsMatch(hash, hashOutcomeSecret(secret))).toBe(true);
    expect(hash).not.toBe(secret);
  });
});

describe("csv import parsing", () => {
  it("strips a BOM and detects semicolon delimiters", () => {
    const parsed = parseCsvText(
      "\uFEFFexternalLeadId;status;revenue;currency\nquote_1;WON;4500.00;EUR\n",
    );
    expect(parsed.delimiter).toBe(";");
    expect(parsed.headers).toEqual([
      "externalLeadId",
      "status",
      "revenue",
      "currency",
    ]);
    expect(parsed.rows[0]).toEqual(["quote_1", "WON", "4500.00", "EUR"]);
  });

  it("detects commas in the header", () => {
    expect(detectCsvDelimiter("a,b;c")).toBe(",");
  });

  it("flags spreadsheet formula cells", () => {
    expect(cellLooksLikeFormula("=1+1")).toBe(true);
    expect(cellLooksLikeFormula("WON")).toBe(false);
  });
});

describe("mutationIdForExternalEvent", () => {
  it("is stable for the same integration and source event", () => {
    const first = mutationIdForExternalEvent("int-1", "evt-1");
    const second = mutationIdForExternalEvent("int-1", "evt-1");
    expect(first).toBe(second);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(mutationIdForExternalEvent("int-1", "evt-2")).not.toBe(first);
  });
});
