import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
