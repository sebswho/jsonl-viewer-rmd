// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { isManagedViewerProcess, restartViewerServer } from "./restart-3201.mjs";

describe("isManagedViewerProcess", () => {
  it("matches a next start process that belongs to this workspace", () => {
    expect(
      isManagedViewerProcess(
        {
          name: "node.exe",
          commandLine:
            'C:\\Program Files\\nodejs\\node.exe "D:\\Projects\\jsonl-viewer-rmd\\node_modules\\.bin\\next" start --hostname 0.0.0.0 --port 3201',
        },
        "D:\\Projects\\jsonl-viewer-rmd",
        3201,
      ),
    ).toBe(true);
  });

  it("does not match an unrelated process that happens to use the same port", () => {
    expect(
      isManagedViewerProcess(
        {
          name: "python.exe",
          commandLine: 'python -m http.server 3201 --directory C:\\temp',
        },
        "D:\\Projects\\jsonl-viewer-rmd",
        3201,
      ),
    ).toBe(false);
  });
});

describe("restartViewerServer", () => {
  it("refuses to stop an unrelated process that already owns the target port", async () => {
    const stopProcessTree = vi.fn();
    const ensureBuildExists = vi.fn();
    const startDetachedServer = vi.fn();
    const waitForPort = vi.fn();

    await expect(
      restartViewerServer(
        {
          workspacePath: "D:\\Projects\\jsonl-viewer-rmd",
          port: 3201,
        },
        {
          resolvePnpmCommand: () => "C:\\pnpm.cmd",
          getListeningProcess: () => ({
            Name: "python.exe",
            CommandLine: "python -m http.server 3201",
            ProcessId: 42,
          }),
          stopProcessTree,
          ensureBuildExists,
          startDetachedServer,
          waitForPort,
        },
      ),
    ).rejects.toThrow(/Port 3201 is already in use by another process/);

    expect(stopProcessTree).not.toHaveBeenCalled();
    expect(ensureBuildExists).not.toHaveBeenCalled();
    expect(startDetachedServer).not.toHaveBeenCalled();
    expect(waitForPort).not.toHaveBeenCalled();
  });

  it("stops the current managed service and starts a replacement", async () => {
    const stopProcessTree = vi.fn();
    const ensureBuildExists = vi.fn();
    const waitForPort = vi.fn();
    const startDetachedServer = vi.fn(() => ({
      pid: 999,
      stdoutLog: "D:\\Projects\\jsonl-viewer-rmd\\.runtime\\server-3201.out.log",
      stderrLog: "D:\\Projects\\jsonl-viewer-rmd\\.runtime\\server-3201.err.log",
    }));

    const server = await restartViewerServer(
      {
        workspacePath: "D:\\Projects\\jsonl-viewer-rmd",
        port: 3201,
      },
      {
        resolvePnpmCommand: () => "C:\\pnpm.cmd",
        getListeningProcess: () => ({
          Name: "node.exe",
          CommandLine:
            'C:\\Program Files\\nodejs\\node.exe "D:\\Projects\\jsonl-viewer-rmd\\node_modules\\.bin\\next" start --hostname 0.0.0.0 --port 3201',
          ProcessId: 77,
        }),
        stopProcessTree,
        ensureBuildExists,
        startDetachedServer,
        waitForPort,
      },
    );

    expect(stopProcessTree).toHaveBeenCalledWith(77);
    expect(ensureBuildExists).toHaveBeenCalledWith(
      "D:\\Projects\\jsonl-viewer-rmd",
      "C:\\pnpm.cmd",
    );
    expect(startDetachedServer).toHaveBeenCalledWith(
      "D:\\Projects\\jsonl-viewer-rmd",
      "C:\\pnpm.cmd",
      3201,
    );
    expect(waitForPort).toHaveBeenCalledWith(3201, 20000);
    expect(server.pid).toBe(999);
  });
});
