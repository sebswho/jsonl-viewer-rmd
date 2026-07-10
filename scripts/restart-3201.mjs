import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 3201;
const HOST = "0.0.0.0";
const START_TIMEOUT_MS = 20000;

export function normalizePathForMatch(value) {
  return value.replaceAll("/", "\\").toLowerCase();
}

export function isManagedViewerProcess(processInfo, workspacePath, port) {
  const commandLine = processInfo.commandLine ?? processInfo.CommandLine ?? "";
  const processName = (
    processInfo.name ??
    processInfo.Name ??
    ""
  ).toLowerCase();
  const normalizedWorkspacePath = normalizePathForMatch(workspacePath);
  const normalizedCommandLine = normalizePathForMatch(commandLine);

  const isNodeStartChain =
    processName.includes("node") ||
    processName.includes("pnpm") ||
    processName.includes("cmd");
  const referencesWorkspace = normalizedCommandLine.includes(
    normalizedWorkspacePath,
  );
  const referencesNextStart =
    normalizedCommandLine.includes("next") &&
    normalizedCommandLine.includes("start");
  const referencesPort = normalizedCommandLine.includes(String(port));

  return (
    isNodeStartChain &&
    referencesWorkspace &&
    referencesNextStart &&
    referencesPort
  );
}

export function getRuntimePaths(workspacePath, port) {
  const runtimeDir = path.join(workspacePath, ".runtime");
  return {
    runtimeDir,
    stdoutLog: path.join(runtimeDir, `server-${port}.out.log`),
    stderrLog: path.join(runtimeDir, `server-${port}.err.log`),
  };
}

export function getManagedStartArgs(workspacePath, port) {
  return [
    path.join(workspacePath, "node_modules", "next", "dist", "bin", "next"),
    "start",
    "--hostname",
    HOST,
    "--port",
    String(port),
  ];
}

function runCommandOrThrow(command, args, options = {}) {
  const completed = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });

  if (completed.status !== 0) {
    throw new Error(
      completed.stderr?.trim() ||
        completed.stdout?.trim() ||
        `${command} exited with code ${completed.status ?? "unknown"}`,
    );
  }

  return completed.stdout?.trim() ?? "";
}

function runPowerShell(command) {
  return runCommandOrThrow(
    "powershell.exe",
    ["-NoProfile", "-Command", command],
    { windowsHide: true },
  );
}

function safeParseJson(value) {
  if (!value) return null;
  return JSON.parse(value);
}

function resolvePnpmCommand() {
  const output = runCommandOrThrow("where", ["pnpm.cmd"], { windowsHide: true });
  return output.split(/\r?\n/).find(Boolean) ?? "pnpm.cmd";
}

function getListeningProcess(port) {
  const json = runPowerShell(`
$connection = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $connection) { exit 0 }
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" | Select-Object ProcessId, Name, CommandLine, ExecutablePath
$process | ConvertTo-Json -Compress
`);

  if (!json) {
    return null;
  }

  return safeParseJson(json);
}

function stopProcessTree(pid) {
  runCommandOrThrow("taskkill", ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
  });
}

function buildViewer(workspacePath, pnpmCommand) {
  console.log("Building production bundle with pnpm build...");
  const completed = spawnSync(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/c", "call", pnpmCommand, "build"],
    {
      cwd: workspacePath,
      stdio: "inherit",
      windowsHide: false,
    },
  );

  if (completed.error) {
    throw new Error(`Unable to start pnpm build: ${completed.error.message}`);
  }

  if (completed.status !== 0) {
    throw new Error(`pnpm build failed with code ${completed.status ?? "unknown"}`);
  }
}

function waitForPortState(port, timeoutMs, shouldBeListening) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;

    const attempt = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      let attemptFinished = false;

      const handleResult = (isListening) => {
        if (attemptFinished || settled) {
          return;
        }

        attemptFinished = true;
        socket.destroy();

        if (isListening === shouldBeListening) {
          settled = true;
          resolve();
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          settled = true;
          const expectedState = shouldBeListening
            ? "accept connections"
            : "be released";
          reject(
            new Error(`Timed out waiting for port ${port} to ${expectedState}`),
          );
          return;
        }

        setTimeout(attempt, 300);
      };

      socket.once("connect", () => handleResult(true));
      socket.once("error", () => handleResult(false));
    };

    attempt();
  });
}

function waitForPortRelease(port, timeoutMs) {
  return waitForPortState(port, timeoutMs, false);
}

function waitForPort(port, timeoutMs) {
  return waitForPortState(port, timeoutMs, true);
}

function startDetachedServer(workspacePath, port) {
  const runtimePaths = getRuntimePaths(workspacePath, port);
  const startArgs = getManagedStartArgs(workspacePath, port);
  const nextCliPath = startArgs[0];

  if (!fs.existsSync(nextCliPath)) {
    throw new Error(
      `Cannot find Next.js start entry at ${nextCliPath}. Run pnpm install first.`,
    );
  }

  fs.mkdirSync(runtimePaths.runtimeDir, { recursive: true });
  fs.writeFileSync(runtimePaths.stdoutLog, "");
  fs.writeFileSync(runtimePaths.stderrLog, "");
  const stdoutFd = fs.openSync(runtimePaths.stdoutLog, "a");
  const stderrFd = fs.openSync(runtimePaths.stderrLog, "a");

  try {
    const child = spawn(
      process.execPath,
      startArgs,
      {
        cwd: workspacePath,
        detached: true,
        stdio: ["ignore", stdoutFd, stderrFd],
        windowsHide: true,
      },
    );

    child.unref();

    return {
      pid: child.pid,
      ...runtimePaths,
    };
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
}

function getDefaultDependencies() {
  return {
    resolvePnpmCommand,
    getListeningProcess,
    stopProcessTree,
    waitForPortRelease,
    buildViewer,
    startDetachedServer,
    waitForPort,
  };
}

export async function restartViewerServer(
  {
    workspacePath,
    port = DEFAULT_PORT,
  },
  dependencies = {},
) {
  const {
    resolvePnpmCommand: resolvePnpm,
    getListeningProcess: getActiveProcess,
    stopProcessTree: stopManagedProcessTree,
    waitForPortRelease: waitUntilPortReleased,
    buildViewer: buildProduction,
    startDetachedServer: startServer,
    waitForPort: waitUntilPortReady,
  } = {
    ...getDefaultDependencies(),
    ...dependencies,
  };
  const pnpmCommand = resolvePnpm();
  const activeProcess = getActiveProcess(port);

  if (activeProcess) {
    if (!isManagedViewerProcess(activeProcess, workspacePath, port)) {
      throw new Error(
        `Port ${port} is already in use by another process (${activeProcess.name ?? activeProcess.Name ?? "unknown"} pid ${activeProcess.ProcessId ?? activeProcess.processId ?? "unknown"}).`,
      );
    }

    console.log(
      `Stopping existing viewer process ${activeProcess.ProcessId ?? activeProcess.processId} on port ${port}...`,
    );
    stopManagedProcessTree(activeProcess.ProcessId ?? activeProcess.processId);
    await waitUntilPortReleased(port, START_TIMEOUT_MS);
  }

  buildProduction(workspacePath, pnpmCommand);

  const server = startServer(workspacePath, port);
  await waitUntilPortReady(port, START_TIMEOUT_MS);

  return server;
}

async function main() {
  const scriptPath = fileURLToPath(import.meta.url);
  const workspacePath = path.resolve(path.dirname(scriptPath), "..");

  try {
    const server = await restartViewerServer({ workspacePath });
    console.log(`Viewer server is running on http://127.0.0.1:${DEFAULT_PORT}`);
    console.log(`stdout: ${server.stdoutLog}`);
    console.log(`stderr: ${server.stderrLog}`);
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
