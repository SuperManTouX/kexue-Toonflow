import { resolve } from "node:path";

const desktopMode = process.argv[2] === "desktop";
const appDirectory = resolve(import.meta.dirname, "..");
const webPort = process.env.TOONFLOW_DEV_WEB_PORT || "5173";
const serverPort = process.env.TOONFLOW_DEV_SERVER_PORT || "3000";
const linuxDevWorkspaceDirectory = desktopMode && process.platform === "linux"
  ? resolve(appDirectory, process.env.TOONFLOW_DEV_WORKSPACE_DIR?.trim() || "data/workspaces/linuxDevWorkspace")
  : undefined;
if (process.argv.length > 3 || process.argv[2] && !desktopMode) {
  console.error("用法：bun scripts/devStack.ts [desktop]");
  process.exit(1);
}

if (!desktopMode && !process.env.EXTERNAL_TOKEN_VERIFICATION_URL) {
  console.error("请先设置 EXTERNAL_TOKEN_VERIFICATION_URL（可写入仓库根目录 .env），再启动 SXWZ 开发服务。");
  process.exit(1);
}

if (desktopMode) console.log(`桌面端浏览器联调：http://127.0.0.1:${webPort}/?desktop=1${linuxDevWorkspaceDirectory ? "&linuxDevWorkspace=1" : ""}`);

const services = [
  { name: "Web", directory: resolve(import.meta.dirname, "../apps/web"), environment: { TOONFLOW_DEV_WEB_PORT: webPort, TOONFLOW_DEV_SERVER_PORT: serverPort } },
  { name: "Server", directory: resolve(import.meta.dirname, "../apps/server"), environment: { TOONFLOW_DEV_SERVER_PORT: serverPort } },
];
const processes = services.map(service => ({
  ...service,
  process: Bun.spawn([process.execPath, "run", "--no-orphans", "dev"], {
    cwd: service.directory,
    env: {
      ...process.env,
      ...service.environment,
      TOONFLOW_DEV_DESKTOP_WEB: desktopMode ? "1" : "0",
      ...(linuxDevWorkspaceDirectory ? {
        TOONFLOW_DEV_WORKSPACE_DIR: linuxDevWorkspaceDirectory,
        VITE_TOONFLOW_DEV_WORKSPACE_DIR: linuxDevWorkspaceDirectory,
      } : {}),
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }),
}));

let stopping = false;
let requestStop: (exitCode: number) => void;
const stopped = new Promise<number>(resolveStop => { requestStop = resolveStop; });

async function stopStack(exitCode: number) {
  if (stopping) return;
  stopping = true;
  const forceStop = setTimeout(() => {
    for (const child of processes) if (child.process.exitCode === null) child.process.kill("SIGKILL");
  }, 5000);
  forceStop.unref();
  for (const child of processes) if (child.process.exitCode === null) child.process.kill("SIGTERM");
  await Promise.all(processes.map(child => child.process.exited));
  clearTimeout(forceStop);
  requestStop(exitCode);
}

process.once("SIGINT", () => { void stopStack(130); });
process.once("SIGTERM", () => { void stopStack(143); });
for (const child of processes) {
  void child.process.exited.then(exitCode => {
    if (stopping) return;
    console.error(`${child.name} 开发服务已退出（${exitCode}），正在停止整个开发栈。`);
    void stopStack(exitCode);
  });
}

process.exitCode = await stopped;
