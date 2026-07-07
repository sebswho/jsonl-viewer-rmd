import { render, screen } from "@testing-library/react";
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
});
