import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  writable: true,
  value: MockResizeObserver,
});

Object.defineProperty(navigator, "clipboard", {
  writable: true,
  value: {
    writeText: () => Promise.resolve(),
  },
});
