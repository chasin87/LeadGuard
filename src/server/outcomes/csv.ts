import { getOutcomeIngestionConfig } from "@/server/outcomes/config";

export type ParsedTabularFile = {
  headers: string[];
  rows: string[][];
  delimiter: "," | ";";
};

const FORMULA_PREFIX = /^[=+\-@]/;

export class TabularParseError extends Error {
  readonly code:
    "INVALID_FILE" | "FILE_TOO_LARGE" | "TOO_MANY_ROWS" | "FORMULA_CELL";
  constructor(code: TabularParseError["code"], message: string) {
    super(message);
    this.name = "TabularParseError";
    this.code = code;
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function detectCsvDelimiter(headerLine: string): "," | ";" {
  let inQuotes = false;
  let commas = 0;
  let semis = 0;
  for (const char of headerLine) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (char === ",") commas += 1;
    if (char === ";") semis += 1;
  }
  return semis > commas ? ";" : ",";
}

export function parseCsvLine(line: string, delimiter: "," | ";"): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

export function parseCsvText(text: string): ParsedTabularFile {
  const config = getOutcomeIngestionConfig();
  const normalized = stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((line, index, all) => {
    if (line.length > 0) return true;
    return index < all.length - 1;
  });
  if (lines.length === 0) {
    throw new TabularParseError("INVALID_FILE", "The file is empty.");
  }
  const delimiter = detectCsvDelimiter(lines[0]!);
  const headers = parseCsvLine(lines[0]!, delimiter).map((item) => item.trim());
  if (headers.length === 0 || headers.every((item) => item === "")) {
    throw new TabularParseError("INVALID_FILE", "The file has no headers.");
  }
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    const cells = parseCsvLine(line, delimiter);
    while (cells.length < headers.length) cells.push("");
    rows.push(cells.slice(0, headers.length));
    if (rows.length > config.importMaxRows) {
      throw new TabularParseError(
        "TOO_MANY_ROWS",
        `Files may contain at most ${config.importMaxRows} rows.`,
      );
    }
  }
  return { headers, rows, delimiter };
}

export function cellLooksLikeFormula(value: string): boolean {
  return FORMULA_PREFIX.test(value.trim());
}
