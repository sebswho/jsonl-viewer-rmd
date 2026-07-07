import { describe, expect, it } from "vitest";

import { parseViewerFile, ViewerFileParseError } from "./viewer-file";

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
