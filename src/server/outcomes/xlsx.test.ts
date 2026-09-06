import { describe, expect, it } from "vitest";
import { parseXlsxBuffer } from "./xlsx";
import { TabularParseError } from "./csv";
import { crc32 } from "node:zlib";

function zipStore(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    data.copy(local, 30 + nameBuf.length);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

describe("xlsx import parsing", () => {
  it("reads primitive cell values from a stored worksheet", () => {
    const buffer = zipStore({
      "xl/sharedStrings.xml":
        "<sst><si><t>externalLeadId</t></si><si><t>status</t></si><si><t>quote_1</t></si><si><t>WON</t></si></sst>",
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>',
    });
    const parsed = parseXlsxBuffer(buffer);
    expect(parsed.headers).toEqual(["externalLeadId", "status"]);
    expect(parsed.rows[0]).toEqual(["quote_1", "WON"]);
  });

  it("rejects formula cells", () => {
    const buffer = zipStore({
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="1"><c r="A1"><v>status</v></c></row><row r="2"><c r="A2"><f>A1</f><v>WON</v></c></row></sheetData></worksheet>',
    });
    expect(() => parseXlsxBuffer(buffer)).toThrow(TabularParseError);
  });

  it("rejects macro-enabled workbooks", () => {
    const buffer = zipStore({
      "xl/vbaProject.bin": "MZ",
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="1"><c r="A1"><v>a</v></c></row></sheetData></worksheet>',
    });
    expect(() => parseXlsxBuffer(buffer)).toThrow(/Macro/);
  });
});
