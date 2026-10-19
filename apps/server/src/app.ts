import logger from "morgan";
import express from "express";
import cors from "cors";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { readFile } from "@toonflow/file";
import type { Request, Response, NextFunction } from "express";
import buildRoute from "@/core";
import { errorFromCause } from "@/lib/responseFormat";
import desktopRequest from "@/lib/desktop";
import { getRuntimePlatform } from "@/lib/platform";
import initializePlugins from "@/utils/plugins/initialize";
import { languageRequest, resolveRequestLocale, runWithLocale, setLocaleFallback, translateError, translateMessage } from "@/lib/i18n";
import { detectLocale, normalizeLocale } from "@toonflow/i18n";
import { initializeAuth } from "@/utils/auth";
import { authRequest, internalAuthRequest } from "@/utils/auth/middleware";
import { captureInternalRequestBody } from "@/utils/auth/internalRequest";
import { canManageHost, getCurrentUser, getSharedDataDirectory } from "@/lib/userContext";
import type { AuthMode } from "@/lib/userContext";

const autoInstallProviders = ["tfRouter.ts", "apiMart.ts", "metaso.ts", "compshare.ts"];

export async function createApp({
  webRoot,
  appVersion = "",
  dataDirectory,
  toolsRoot,
  nodesRoot,
  extRoot,
  providersRoot,
  skillsRoot,
  agentsRoot,
  pluginRevision,
  authMode = "local",
}: {
  webRoot: string;
  appVersion?: string;
  dataDirectory?: string;
  toolsRoot?: string;
  nodesRoot?: string;
  extRoot?: string;
  providersRoot?: string;
  skillsRoot?: string;
  agentsRoot?: string;
  pluginRevision?: string;
  authMode?: AuthMode;
}) {
  // conf 由下方的路由动态加载，必须先确定整个进程共用的数据目录。
  if (dataDirectory) process.env.TOONFLOW_DATA_DIR = resolve(dataDirectory);
  await initializeAuth({ dataDirectory: dataDirectory ?? process.env.TOONFLOW_DATA_DIR ?? resolve(import.meta.dirname, "../../..", "data"), mode: authMode });
  const { default: getConfig } = await import("@/utils/conf");
  setLocaleFallback(() => (canManageHost() ? normalizeLocale((getConfig().get("settings", {}).ui as { language?: unknown } | undefined)?.language) : undefined)
    ?? detectLocale([Intl.DateTimeFormat().resolvedOptions().locale]));
  const sharedDirectory = getSharedDataDirectory();
  if (dataDirectory && toolsRoot)
    await initializePlugins(resolve(sharedDirectory, "tools"), toolsRoot, /^[a-z][a-zA-Z0-9]*\.tool\.js$/, pluginRevision);
  if (dataDirectory && nodesRoot) await initializePlugins(resolve(sharedDirectory, "nodes"), nodesRoot, /^[a-z][a-zA-Z0-9]*\.umd\.js$/, pluginRevision);
  if (dataDirectory && extRoot) {
    const { default: initializeExt } = await import("@/utils/plugins/initializeExt");
    await initializeExt(resolve(sharedDirectory, "ext"), extRoot, pluginRevision);
  }
  // ACT: 内置媒体供应商随构建同步，其他供应商文件和独立保存的配置保留。
  if (dataDirectory && providersRoot) {
    const sourceDirectory = resolve(providersRoot, "media");
    let providerRevision = pluginRevision;
    if (providerRevision === undefined) {
      const hash = createHash("sha256");
      for (const name of autoInstallProviders) {
        const source = await readFile(resolve(sourceDirectory, name)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return Buffer.alloc(0);
          throw error;
        });
        hash.update(name).update("\0").update(source).update("\0");
      }
      providerRevision = hash.digest("hex");
    }
    await initializePlugins(resolve(sharedDirectory, "providers"), sourceDirectory, autoInstallProviders, providerRevision);
  }
  // ACT: 技能和团队只补首次安装，保留用户修改。
  if (dataDirectory && skillsRoot) await initializePlugins(resolve(sharedDirectory, "skills"), skillsRoot);
  if (dataDirectory && agentsRoot) await initializePlugins(resolve(sharedDirectory, "agents"), agentsRoot);
  const app = express();
  app.locals.appVersion = appVersion;
  if (!canManageHost()) app.use((_req, res, next) => { res.set("Referrer-Policy", "no-referrer"); next(); });

  if (getRuntimePlatform().development) {
    await buildRoute();
    app.use(logger(canManageHost() ? "dev" : ":method :status :response-time ms"));
  }
  if (canManageHost()) app.use(cors());
  app.use(languageRequest);
  app.use(authRequest);
  app.use("/api/auth/login", express.json({ limit: "12kb", verify: captureInternalRequestBody }));
  app.use("/a2a", express.json({ limit: "2mb", verify: captureInternalRequestBody }));
  app.use(["/api/workspaces/files/write", "/api/assets/save"], express.raw({ type: "application/octet-stream", limit: "100mb", verify: captureInternalRequestBody }));
  app.use(express.json({ limit: "100mb", verify: captureInternalRequestBody }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));
  app.use(internalAuthRequest);
  app.use("/api/desktop", desktopRequest);

  const { default: initializeProviderModels } = await import("@/utils/ai/initialize");
  if (canManageHost()) await initializeProviderModels();
  const router = await import("@/router");
  router.default(app);
  const [{ createMcpRouter }, { getMcpTools }, { authorizeMcp }, { skillResources }] = await Promise.all([
    import("@toonflow/mcp"),
    import("@/utils/mcp/tools"),
    import("@/utils/mcp/control"),
    import("@/utils/mcp/resources"),
  ]);
  app.use("/mcp", createMcpRouter({ getTools: getMcpTools, authorize: authorizeMcp, resources: skillResources,
    getSessionScope: () => getCurrentUser().userId,
    runInRequest: (request, operation) => runWithLocale(resolveRequestLocale(request.get("accept-language")), operation),
    translate: translateMessage,
    translateError,
  }));
  const { createA2aRouter } = await import("@/agent/a2a");
  app.use("/a2a", createA2aRouter());
  app.use(express.static(webRoot));

  // 错误处理
  app.use((err: Error & { status?: number }, request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) return next(err);
    if (canManageHost()) console.error(err);
    else console.error("请求失败", { name: err.name, status: err.status ?? 500 });
    const body = errorFromCause(err);
    response.status(body.code).json(body);
  });

  const { initializeMobileLinkRuntime } = await import("@/utils/mobileLink");
  if (canManageHost()) initializeMobileLinkRuntime(app);
  return app;
}
