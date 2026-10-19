import { mkdir, realpath } from "@toonflow/file";
import { initializeUserContext, getAuthMode, createUserContext, runWithUser } from "@/lib/userContext";
import type { AuthMode } from "@/lib/userContext";
import { configureVerification, verifyExternalToken } from "./verify";
import { initializeAuthStorage, createStoredLogin, findServiceUser, hashCredential } from "./storage";
import type { ServiceKind } from "./storage";

export { getAuthMode, canManageHost, getCurrentUser, createUserContext, runWithUser } from "@/lib/userContext";
export type { SuanliIdentity } from "@/lib/userContext";
export { resolveSession, revokeSession, registerServiceCredential, findStoredUser, sessionLifetime } from "./storage";
export type { AuthUser, ServiceKind } from "./storage";

export async function initializeAuth({ dataDirectory, mode }: { dataDirectory: string; mode: AuthMode }) {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const directory = await realpath(dataDirectory);
  initializeUserContext(directory, mode);
  if (mode === "sxwz") {
    if (process.env.TOONFLOW_PUBLIC_URL) {
      const url = new URL(process.env.TOONFLOW_PUBLIC_URL);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash
        || (process.env.NODE_ENV !== "dev" && url.protocol !== "https:")) throw new Error("TOONFLOW_PUBLIC_URL 必须为不带路径的 HTTPS 服务地址");
      process.env.TOONFLOW_PUBLIC_URL = url.origin;
    }
    configureVerification();
    await initializeAuthStorage(directory);
  }
}
export async function createLogin(token: string) {
  const identity = await verifyExternalToken(token);
  return createStoredLogin(identity.userName, identity.externalSubject, identity.suanliIdentity);
}
export async function resolveServiceCredential(kind: ServiceKind, token: string) {
  if (getAuthMode() !== "sxwz" || token.length < 32 || token.length > 8192) return;
  const user = await findServiceUser(kind, token);
  if (!user) return;
  return runWithUser(createUserContext(user.id, user.name), async () => {
    const { default: getConfig } = await import("@/utils/conf");
    const config = getConfig();
    const setting = (kind === "mcp" ? config.get("settings", {}).mcp : config.get("a2a")) as { enabled?: boolean; token?: string } | undefined;
    return setting?.enabled === true && typeof setting.token === "string" && hashCredential(setting.token) === hashCredential(token) ? user : undefined;
  });
}
