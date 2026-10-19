import conf from "conf";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from "@toonflow/file";
import { resolve } from "node:path";
import tfRouter from "@toonflow/providers/language/tfRouter";
import type { RemoteTeam } from "@/utils/teams";
import type { A2aSettings } from "@/agent/a2a/settings";
import type { desktopUpdateAttempt } from "@/types/desktop";
import type { MobileLinkConfig } from "@/utils/mobileLink";
import { normalizeNodeMenu, serializeNodeMenu } from "@/lib/nodeMenu";
import { canManageHost, getCurrentUser, getSharedDataDirectory, runWithUser } from "@/lib/userContext";

const autoInstallProviders = [tfRouter];
type ConfigData = { settings: Record<string, unknown>; disabledSkills: string[]; disabledTools: string[]; disabledNodes: string[]; disabledExt: string[]; disabledAgents: string[]; mediaProviderModels: Record<string, unknown>; toolConfigs: Record<string, Record<string, unknown>>; nodeConfigs: Record<string, Record<string, unknown>>; extConfigs: Record<string, Record<string, unknown>>; remoteConnections: Record<string, RemoteTeam>; a2a: A2aSettings; desktopUpdateAttempt: desktopUpdateAttempt; mobileLink: MobileLinkConfig };
const configs = new Map<string, conf<ConfigData>>();
const listeners: { key: string; callback: (next: any, previous: any) => void }[] = [];
const enabledKeys = { tool: "disabledTools", node: "disabledNodes", ext: "disabledExt", agent: "disabledAgents" } as const;

export function isResourceEnabled(kind: keyof typeof enabledKeys, name: string) {
  if (canManageHost()) return !existsSync(resolve(getSharedDataDirectory(), { tool: "tools", node: "nodes", ext: "ext", agent: "agents" }[kind], `${name}.disabled`));
  return !getConfig().get(enabledKeys[kind], []).includes(name);
}
export function setResourceEnabled(kind: keyof typeof enabledKeys, name: string, enabled: boolean) {
  const config = getConfig();
  const key = enabledKeys[kind];
  const disabled = config.get(key, []).filter(item => item !== name);
  config.set(key, enabled ? disabled : [...disabled, name]);
}

export function onConfigChange(key: string, callback: (next: any, previous: any) => void) {
  const listener = { key, callback };
  listeners.push(listener);
  for (const [userId, config] of configs) {
    const context = { userId, name: "", dataDirectory: resolve(config.path, "..") };
    config.onDidChange(key as keyof ConfigData, (next, previous) => runWithUser(context, () => callback(next, previous)));
  }
}

export default function getConfig() {
  const user = getCurrentUser();
  const cached = configs.get(user.userId);
  if (cached) return cached;
  if (!canManageHost()) {
    const usersDirectory = resolve(user.dataDirectory, "..");
    mkdirSync(usersDirectory, { recursive: true, mode: 0o700 });
    const usersInfo = lstatSync(usersDirectory);
    if (usersInfo.isSymbolicLink() || !usersInfo.isDirectory() || realpathSync(usersDirectory) !== usersDirectory) throw new Error("用户数据目录不能包含符号链接");
    chmodSync(usersDirectory, 0o700);
  }
  mkdirSync(user.dataDirectory, { recursive: true, mode: 0o700 });
  const actualDirectory = realpathSync(user.dataDirectory);
  if (!canManageHost() && (lstatSync(user.dataDirectory).isSymbolicLink() || actualDirectory !== user.dataDirectory)) throw new Error("用户数据目录不能包含符号链接");
  if (!canManageHost()) chmodSync(user.dataDirectory, 0o700);
  const config = new conf<ConfigData>({ cwd: actualDirectory, configName: "settings", configFileMode: 0o600, watch: true });
  if (canManageHost()) {
    const settings = config.get("settings", {});
    if (removeLegacySettings(settings)) config.set("settings", settings);
  }
  if (!config.has("settings.customProviders")) config.set("settings.customProviders", autoInstallProviders.map(({ id, label, icon, version, apiUrl, protocol, models }) =>
    ({ id, label, icon, version, apiUrl, protocol, models, apiKey: "" })));
  if (!canManageHost()) mkdirSync(resolve(user.dataDirectory, "workspaces"), { recursive: true, mode: 0o700 });
  const skills = resolve(user.dataDirectory, "skills");
  const templates = resolve(getSharedDataDirectory(), "skills");
  if (!canManageHost() && !existsSync(skills) && existsSync(templates)) cpSync(templates, skills, { recursive: true, force: false, errorOnExist: true });
  configs.set(user.userId, config);
  for (const { key, callback } of listeners) config.onDidChange(key as keyof ConfigData, (next, previous) => runWithUser(user, () => callback(next, previous)));
  return config;
}

export function removeLegacySettings(settings: Record<string, unknown>) {
  let changed = false;
  for (const [record, key] of [[settings, "developerConfirmed"], [settings.general, "systemPrompt"], [settings.stores, "toonflow.developer"]] as const) {
    if (record && typeof record === "object" && !Array.isArray(record) && Object.hasOwn(record, key)) {
      Reflect.deleteProperty(record, key);
      changed = true;
    }
  }
  return changed;
}

export function cleanNodeMenuSettings(settings: Record<string, unknown>) {
  const general = settings.general;
  if (!general || typeof general !== "object" || Array.isArray(general) || !Object.hasOwn(general, "nodeMenu")) return false;
  const record = general as Record<string, unknown>;
  const installedTypes = new Set<string>();
  try {
    // ACT: 仅扫描已安装文件名；禁用节点保留配置，菜单清理与同步存盘间不插入异步等待。
    for (const file of readdirSync(resolve(getSharedDataDirectory(), "nodes"), { withFileTypes: true })) {
      if (file.isFile() && /^[a-z][a-zA-Z0-9]*\.umd\.js$/.test(file.name)) installedTypes.add(`remote-${file.name.slice(0, -7)}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const nodeMenu = serializeNodeMenu(normalizeNodeMenu(record.nodeMenu), installedTypes);
  if (!nodeMenu.length) {
    delete record.nodeMenu;
    return true;
  }
  if (JSON.stringify(record.nodeMenu) === JSON.stringify(nodeMenu)) return false;
  record.nodeMenu = nodeMenu;
  return true;
}
