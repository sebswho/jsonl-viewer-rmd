import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Home from "./page";

vi.mock("react-window", () => ({
  List: ({ rowCount, rowComponent: Row, style }: any) => (
    <div style={style}>
      {Array.from({ length: rowCount }, (_, index) => (
        <Row
          key={index}
          index={index}
          style={{}}
          ariaAttributes={{
            "aria-posinset": index + 1,
            "aria-setsize": rowCount,
            role: "listitem",
          }}
        />
      ))}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("Home page", () => {
  it("renders a Chinese empty state and accepts both JSON and JSONL files", () => {
    const { container } = render(<Home />);

    expect(screen.getByText("JSON 查看器")).toBeInTheDocument();
    expect(screen.getByText(/拖放/i)).toHaveTextContent(
      "拖放 .json 或 .jsonl 文件到这里",
    );
    expect(screen.getAllByText("打开文件")).toHaveLength(2);

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toHaveAttribute("accept", ".jsonl,.json,.log,.txt");
  });

  it("falls back to temporary file input when native picker is unavailable", async () => {
    render(<Home />);
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");

    fireEvent.click(screen.getAllByRole("button", { name: "打开文件" })[0]);

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("当前访问方式将以临时导入打开本地文件，刷新后不会自动恢复。"),
    ).toBeInTheDocument();
  });

  it("keeps using the native picker when it is available", async () => {
    const nativePicker = vi.fn().mockResolvedValue([]);

    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      writable: true,
      value: nativePicker,
    });

    render(<Home />);

    fireEvent.click(screen.getAllByRole("button", { name: "打开文件" })[0]);

    await waitFor(() => {
      expect(nativePicker).toHaveBeenCalledTimes(1);
    });

    Reflect.deleteProperty(window, "showOpenFilePicker");
  });
});

async function uploadFile(content: string, name: string, firstRowText: string) {
  const { container } = render(<Home />);
  const input = container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;

  fireEvent.change(input, {
    target: {
      files: [new File([content], name, { type: "application/json" })],
    },
  });

  await waitFor(() => {
    expect(screen.getByText(firstRowText)).toBeInTheDocument();
  });

  return container;
}

describe("record editing", () => {
  it("shows a context menu with edit and delete on right-click of a JSONL row", async () => {
    await uploadFile('{"a":1}\n{"b":2}', "logs.jsonl", '{"a":1}');

    fireEvent.contextMenu(screen.getByText('{"a":1}'));

    expect(screen.getByText("修改行")).toBeInTheDocument();
    expect(screen.getByText("删除行")).toBeInTheDocument();
  });

  it("enters edit mode with formatted content and marks validity", async () => {
    const container = await uploadFile(
      '{"a":1}\n{"b":2}',
      "logs.jsonl",
      '{"a":1}',
    );

    fireEvent.contextMenu(screen.getByText('{"a":1}'));
    fireEvent.click(screen.getByText("修改行"));

    const editor = container.querySelector(
      "textarea",
    ) as HTMLTextAreaElement;
    expect(editor.value).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(editor.getAttribute("data-edit-valid")).toBe("true");
    expect(
      screen.getByRole("button", { name: "保存修改" }),
    ).not.toBeDisabled();
  });

  it("turns invalid and disables save while editing broken JSON", async () => {
    const container = await uploadFile(
      '{"a":1}\n{"b":2}',
      "logs.jsonl",
      '{"a":1}',
    );

    fireEvent.contextMenu(screen.getByText('{"a":1}'));
    fireEvent.click(screen.getByText("修改行"));

    const editor = container.querySelector(
      "textarea",
    ) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "{bad" } });

    expect(editor.getAttribute("data-edit-valid")).toBe("false");
    expect(
      screen.getByRole("button", { name: "保存修改" }),
    ).toBeDisabled();
  });

  it("commits an edit so the record updates to compact JSON", async () => {
    const container = await uploadFile(
      '{"a":1}\n{"b":2}',
      "logs.jsonl",
      '{"a":1}',
    );

    fireEvent.contextMenu(screen.getByText('{"a":1}'));
    fireEvent.click(screen.getByText("修改行"));

    const editor = container.querySelector(
      "textarea",
    ) as HTMLTextAreaElement;
    expect(editor.value).toBe(JSON.stringify({ a: 1 }, null, 2));
    fireEvent.change(editor, {
      target: { value: JSON.stringify({ a: 99 }) },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(screen.getByText('{"a":99}')).toBeInTheDocument();
    });
    expect(screen.queryByText('{"a":1}')).not.toBeInTheDocument();
    expect(screen.getByText("已修改")).toBeInTheDocument();
  });

  it("deletes a JSONL row after confirming the warning modal", async () => {
    await uploadFile('{"a":1}\n{"b":2}', "logs.jsonl", '{"a":1}');

    fireEvent.contextMenu(screen.getByText('{"a":1}'));
    fireEvent.click(screen.getByText("删除行"));

    expect(screen.getByText("确认删除行")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(screen.queryByText('{"a":1}')).not.toBeInTheDocument();
    });
    expect(screen.getByText("已修改")).toBeInTheDocument();
  });
});

describe("JSON record editing", () => {
  it("offers edit but not delete for .json files", async () => {
    await uploadFile('{"id":1}', "r.json", '{"id":1}');

    fireEvent.contextMenu(screen.getByText('{"id":1}'));

    expect(screen.getByText("修改行")).toBeInTheDocument();
    expect(screen.queryByText("删除行")).not.toBeInTheDocument();
  });
});
