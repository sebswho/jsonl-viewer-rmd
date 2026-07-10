import { describe, expect, it } from "vitest";

import {
  parseViewerFile,
  reparseRecord,
  serializeViewerFile,
  ViewerFileParseError,
} from "./viewer-file";

describe("parseViewerFile", () => {
  it("maps a JSON array into one record per element", () => {
    const file = parseViewerFile({
      id: "f1",
      name: "records.json",
      content: '[{"id":1},{"id":2}]',
      source: "input",
    });

    expect(file.format).toBe("json");
    expect(file.lines).toHaveLength(2);
    expect(file.lines.map((line) => line.raw)).toEqual([
      '{"id":1}',
      '{"id":2}',
    ]);
    expect(file.lines.map((line) => line.parsed)).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    expect(file.jsonIsArray).toBe(true);
  });

  it("keeps a JSON object as a single record", () => {
    const file = parseViewerFile({
      id: "f2",
      name: "manifest.json",
      content: '{"name":"viewer","version":1}',
      source: "input",
    });

    expect(file.lines).toHaveLength(1);
    expect(file.lines[0].raw).toBe('{"name":"viewer","version":1}');
    expect(file.lines[0].parsed).toEqual({ name: "viewer", version: 1 });
    expect(file.jsonIsArray).toBe(false);
  });

  it("parses JSONL line by line and preserves invalid rows", () => {
    const file = parseViewerFile({
      id: "f3",
      name: "logs.jsonl",
      content: '{"ok":1}\nnot-json\n{"ok":2}\n',
      source: "input",
    });

    expect(file.format).toBe("jsonl");
    expect(file.lines).toHaveLength(3);
    expect(file.lines[0].parsed).toEqual({ ok: 1 });
    expect(file.lines[1].error).toBe("无效 JSON");
    expect(file.lines[2].parsed).toEqual({ ok: 2 });
  });

  it("throws a Chinese parse error for invalid JSON files", () => {
    expect(() =>
      parseViewerFile({
        id: "f4",
        name: "broken.json",
        content: '{"missing": }',
        source: "input",
      }),
    ).toThrowError(new ViewerFileParseError("JSON 文件解析失败"));
  });
});

describe("serializeViewerFile", () => {
  it("joins JSONL records as compact single-line JSON, preserving unedited raw", () => {
    const file = parseViewerFile({
      id: "s1",
      name: "logs.jsonl",
      content: '{"a":1}\n{"b":2}\n',
      source: "input",
    });

    expect(serializeViewerFile(file)).toBe('{"a":1}\n{"b":2}');
  });

  it("serializes a JSON array file as a pretty 2-space document", () => {
    const file = parseViewerFile({
      id: "s2",
      name: "records.json",
      content: '[{"id":1},{"id":2}]',
      source: "input",
    });

    expect(serializeViewerFile(file)).toBe(
      JSON.stringify([{ id: 1 }, { id: 2 }], null, 2),
    );
  });

  it("serializes a single-object JSON file as a pretty 2-space document", () => {
    const file = parseViewerFile({
      id: "s3",
      name: "manifest.json",
      content: '{"name":"viewer","version":1}',
      source: "input",
    });

    expect(serializeViewerFile(file)).toBe(
      JSON.stringify({ name: "viewer", version: 1 }, null, 2),
    );
  });

  it("round-trips edited JSONL records as compact lines", () => {
    const file = parseViewerFile({
      id: "s4",
      name: "logs.jsonl",
      content: '{"a":1}\n{"b":2}',
      source: "input",
    });

    file.lines[0] = {
      ...file.lines[0],
      raw: JSON.stringify({ a: 99 }),
      parsed: { a: 99 },
    };

    expect(serializeViewerFile(file)).toBe('{"a":99}\n{"b":2}');
  });
});

describe("reparseRecord", () => {
  it("returns parsed value without error for valid JSON", () => {
    expect(reparseRecord('{"a":1}')).toEqual({
      parsed: { a: 1 },
      error: undefined,
    });
  });

  it("returns an error message for invalid JSON", () => {
    const result = reparseRecord("{bad");

    expect(result.parsed).toBeNull();
    expect(typeof result.error).toBe("string");
    expect(result.error?.length).toBeGreaterThan(0);
  });
});
