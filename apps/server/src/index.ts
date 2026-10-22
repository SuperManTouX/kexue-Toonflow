import { resolve } from "node:path";
import { mkdir, writeAtomic } from "@toonflow/file";
import { createApp } from "./app";
import { canManageHost } from "./lib/userContext";
import { setRuntimeHost } from "./lib/platform";
import createLinuxDevRuntime from "./utils/desktop/linuxDevRuntime";
import config from "../../../electrobun.config";

const startTime = Date.now();
const realPort = Number(process.env.TOONFLOW_DEV_SERVER_PORT || 3000);
// 源码位于 apps/server/src，生产构建位于 build/server，均从文件位置定位根目录。
const fromSource = import.meta.path.endsWith(".ts");
const appDirectory = resolve(import.meta.dirname, fromSource ? "../../.." : "../..");
const dataDirectory = process.env.TOONFLOW_DATA_DIR ?? resolve(appDirectory, "data");
const desktopWebDevelopment = process.env.NODE_ENV === "dev" && process.env.TOONFLOW_DEV_DESKTOP_WEB === "1";
if (desktopWebDevelopment) setRuntimeHost("desktop");
const linuxDevWorkspaceDirectory = desktopWebDevelopment && process.platform === "linux"
  ? process.env.TOONFLOW_DEV_WORKSPACE_DIR ?? resolve(appDirectory, "data/workspaces/linuxDevWorkspace")
  : undefined;
if (linuxDevWorkspaceDirectory) {
  await mkdir(linuxDevWorkspaceDirectory, { recursive: true });
  await writeAtomic(resolve(linuxDevWorkspaceDirectory, "画布1.json"), JSON.stringify({
    toonflowCanvas: true,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }), { exclusive: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
}
const app = await createApp({
  authMode: desktopWebDevelopment ? "local" : "sxwz",
  webRoot: resolve(appDirectory, "build/web"),
  appVersion: config.app.version,
  dataDirectory,
  toolsRoot: resolve(appDirectory, "build/tools"),
  nodesRoot: resolve(appDirectory, "build/nodes"),
  extRoot: resolve(appDirectory, "build/ext"),
  // ACT: 暂不安装内置团队，随团队打包一同恢复。
  // agentsRoot: resolve(appDirectory, "build/agents"),
  providersRoot: resolve(appDirectory, fromSource ? "packages/providers/src" : "build/providers"),
  skillsRoot: resolve(appDirectory, fromSource ? "packages/skills" : "build/skills"),
});
if (desktopWebDevelopment) app.locals.desktop = createLinuxDevRuntime(config.app.version);
const { initializeMcpRuntime } = await import("./utils/mcp/runtime");
const { startMobileLinkRuntime } = await import("./utils/mobileLink");
app.listen(realPort, async () => {
  await initializeMcpRuntime(app, `http://127.0.0.1:${realPort}`, resolve(appDirectory, fromSource ? "packages/mcp/src/stdio.ts" : "build/mcp/stdio.js"));
  if (canManageHost()) await startMobileLinkRuntime(app).catch(error => console.error("设备互联启动失败：", error));
  console.log(`[服务启动成功]: http://localhost:${realPort}`);
  console.log(`[启动耗时]: ${(Date.now() - startTime).toFixed(2)}ms`);
});
