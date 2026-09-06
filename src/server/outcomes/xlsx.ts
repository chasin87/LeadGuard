import { inflateRawSync } from "node:zlib";
import {
  cellLooksLikeFormula,
  TabularParseError,
  type ParsedTabularFile,
} from "@/server/outcomes/csv";
import { getOutcomeIngestionConfig } from "@/server/outcomes/config";

const EOCD = 0x06054b50;
const LOCAL = 0x04034b50;

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) return i;
  }
  throw new TabularParseError("INVALID_FILE", "The XLSX archive is invalid.");
}

function inflateZipEntries(buffer: Buffer): Map<string, Buffer> {
  const eocd = findEocd(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new TabularParseError(
        "INVALID_FILE",
        "The XLSX archive is invalid.",
      );
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    if (buffer.readUInt32LE(localOffset) !== LOCAL) {
      throw new TabularParseError(
        "INVALID_FILE",
        "The XLSX archive is invalid.",
      );
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) data = compressed;
    else if (method === 8) data = inflateRawSync(compressed);
    else {
      throw new TabularParseError(
        "INVALID_FILE",
        "Unsupported XLSX compression.",
      );
    }
    entries.set(name, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseSharedStrings(xml: string): string[] {
  const values: string[] = [];
  const siBlocks = xml.split(/<si[ >]/).slice(1);
  for (const block of siBlocks) {
    const texts = [...block.matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)].map(
      (match) => decodeXmlEntities(match[1] ?? ""),
    );
    values.push(texts.join(""));
  }
  return values;
}

function columnIndex(cellRef: string): number {
  const letters = cellRef.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

function parseSheetRows(
  xml: string,
  shared: string[],
): { rows: string[][]; formulaRows: Set<number> } {
  const rows: string[][] = [];
  const formulaRows = new Set<number>();
  const rowBlocks = xml.split(/<row[ >]/).slice(1);
  for (const block of rowBlocks) {
    const rowNumber = Number(block.match(/r="(\d+)"/)?.[1] ?? rows.length + 1);
    const cells: string[] = [];
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let match: RegExpExecArray | null;
    while ((match = cellRegex.exec(block))) {
      const attrs = match[1] ?? "";
      const body = match[2] ?? "";
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] ?? "A1";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "";
      if (/<f[\s>]/.test(body)) {
        formulaRows.add(rowNumber - 1);
      }
      const inline = body.match(/<is>[\s\S]*?<t(?: [^>]*)?>([^<]*)<\/t>/)?.[1];
      const rawValue = body.match(/<v>([^<]*)<\/v>/)?.[1] ?? inline ?? "";
      let value = decodeXmlEntities(rawValue);
      if (type === "s") {
        const index = Number(value);
        value = Number.isInteger(index) ? (shared[index] ?? "") : "";
      } else if (type === "b") {
        value = value === "1" ? "TRUE" : "FALSE";
      } else if (type === "e") {
        value = "";
      }
      const index = columnIndex(ref);
      while (cells.length <= index) cells.push("");
      cells[index] = value;
    }
    while (rows.length < rowNumber) rows.push([]);
    rows[rowNumber - 1] = cells;
  }
  return { rows: rows.filter((row) => row.length > 0), formulaRows };
}

export function parseXlsxBuffer(buffer: Buffer): ParsedTabularFile {
  const config = getOutcomeIngestionConfig();
  const entries = inflateZipEntries(buffer);
  if ([...entries.keys()].some((name) => /vbaProject/i.test(name))) {
    throw new TabularParseError(
      "INVALID_FILE",
      "Macro-enabled workbooks are not accepted.",
    );
  }
  const sheet =
    entries.get("xl/worksheets/sheet1.xml") ??
    [...entries.entries()].find(([name]) =>
      name.startsWith("xl/worksheets/sheet"),
    )?.[1];
  if (!sheet) {
    throw new TabularParseError("INVALID_FILE", "The workbook has no sheet.");
  }
  const sharedXml = entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
  const { rows, formulaRows } = parseSheetRows(sheet.toString("utf8"), shared);
  if (rows.length === 0) {
    throw new TabularParseError("INVALID_FILE", "The file is empty.");
  }
  const headers = (rows[0] ?? []).map((item) => item.trim());
  if (headers.length === 0 || headers.every((item) => item === "")) {
    throw new TabularParseError("INVALID_FILE", "The file has no headers.");
  }
  const dataRows: string[][] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const cells = (rows[i] ?? []).slice(0, headers.length);
    while (cells.length < headers.length) cells.push("");
    if (cells.every((cell) => cell.trim() === "")) continue;
    if (formulaRows.has(i)) {
      throw new TabularParseError(
        "FORMULA_CELL",
        "Formula cells are rejected. Export values only.",
      );
    }
    for (const cell of cells) {
      if (cellLooksLikeFormula(cell)) {
        throw new TabularParseError(
          "FORMULA_CELL",
          "Formula cells are rejected. Export values only.",
        );
      }
    }
    dataRows.push(cells);
    if (dataRows.length > config.importMaxRows) {
      throw new TabularParseError(
        "TOO_MANY_ROWS",
        `Files may contain at most ${config.importMaxRows} rows.`,
      );
    }
  }
  return { headers, rows: dataRows, delimiter: "," };
}
