// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  it("rebuilds when a production build already exists", async () => {
    const workspacePath = fs.mkdtempSync(
      path.join(os.tmpdir(), "jsonl-viewer-restart-"),
    );
    const buildMarkerPath = path.join(workspacePath, "build-ran");
    const pnpmCommand = path.join(workspacePath, "fake pnpm.cmd");

    try {
      fs.mkdirSync(path.join(workspacePath, ".next"));
      fs.writeFileSync(path.join(workspacePath, ".next", "BUILD_ID"), "old");
      fs.writeFileSync(
        pnpmCommand,
        `@echo off\r\n> "${buildMarkerPath}" echo yes\r\n`,
      );

      await restartViewerServer(
        { workspacePath, port: 3201 },
        {
          resolvePnpmCommand: () => pnpmCommand,
          getListeningProcess: () => null,
          startDetachedServer: () => ({
            pid: 999,
            stdoutLog: path.join(workspacePath, "stdout.log"),
            stderrLog: path.join(workspacePath, "stderr.log"),
          }),
          waitForPort: () => Promise.resolve(),
        },
      );

      expect(fs.existsSync(buildMarkerPath)).toBe(true);
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("refuses to stop an unrelated process that already owns the target port", async () => {
    const stopProcessTree = vi.fn();
    const buildViewer = vi.fn();
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
          buildViewer,
          startDetachedServer,
          waitForPort,
        },
      ),
    ).rejects.toThrow(/Port 3201 is already in use by another process/);

    expect(stopProcessTree).not.toHaveBeenCalled();
    expect(buildViewer).not.toHaveBeenCalled();
    expect(startDetachedServer).not.toHaveBeenCalled();
    expect(waitForPort).not.toHaveBeenCalled();
  });

  it("stops the current managed service and starts a replacement", async () => {
    const events: string[] = [];
    const stopProcessTree = vi.fn(() => events.push("stop"));
    const waitForPortRelease = vi.fn(async () => events.push("wait-release"));
    const buildViewer = vi.fn(() => events.push("build"));
    const waitForPort = vi.fn(async () => events.push("wait-ready"));
    const startDetachedServer = vi.fn(() => {
      events.push("start");
      return {
        pid: 999,
        stdoutLog:
          "D:\\Projects\\jsonl-viewer-rmd\\.runtime\\server-3201.out.log",
        stderrLog:
          "D:\\Projects\\jsonl-viewer-rmd\\.runtime\\server-3201.err.log",
      };
    });

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
        waitForPortRelease,
        buildViewer,
        startDetachedServer,
        waitForPort,
      },
    );

    expect(stopProcessTree).toHaveBeenCalledWith(77);
    expect(waitForPortRelease).toHaveBeenCalledWith(3201, 20000);
    expect(buildViewer).toHaveBeenCalledWith(
      "D:\\Projects\\jsonl-viewer-rmd",
      "C:\\pnpm.cmd",
    );
    expect(startDetachedServer).toHaveBeenCalledWith(
      "D:\\Projects\\jsonl-viewer-rmd",
      3201,
    );
    expect(waitForPort).toHaveBeenCalledWith(3201, 20000);
    expect(events).toEqual([
      "stop",
      "wait-release",
      "build",
      "start",
      "wait-ready",
    ]);
    expect(server.pid).toBe(999);
  });
});
