import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";
import type { Response } from "express";

export type AuthMode = "local" | "sxwz";
export type UserContext = { userId: string; name: string; dataDirectory: string; sessionHash?: string };

const userContext = new AsyncLocalStorage<UserContext>();
let dataDirectory = process.env.TOONFLOW_DATA_DIR ?? resolve(import.meta.dirname, "../../../..", "data");
let authMode: AuthMode = "local";
const sessionResponses = new Map<string, Set<Response>>();

export function initializeUserContext(directory: string, mode: AuthMode) {
  dataDirectory = resolve(directory);
  authMode = mode;
}

export function getAuthMode() { return authMode; }
export function canManageHost() { return authMode === "local"; }
export function getSharedDataDirectory() { return authMode === "sxwz" ? resolve(dataDirectory, "shared") : dataDirectory; }
export function createUserContext(userId: string, name: string, sessionHash?: string): UserContext {
  if (!/^(?:local|[0-9a-f-]{36})$/.test(userId)) throw new Error("用户标识无效");
  return { userId, name, sessionHash, dataDirectory: authMode === "local" ? dataDirectory : resolve(dataDirectory, "users", userId) };
}
export function getCurrentUser(): UserContext {
  const user = userContext.getStore();
  if (user) return user;
  if (authMode === "local") return createUserContext("local", "本地用户");
  throw Object.assign(new Error("请先通过 SXWZ 登录"), { status: 401 });
}
export function getUserDataDirectory() { return getCurrentUser().dataDirectory; }
export function runWithUser<T>(user: UserContext, operation: () => T): T { return userContext.run(user, operation); }

export function trackSessionResponse(response: Response, sessionHash: string, expiresAt: number) {
  let responses = sessionResponses.get(sessionHash);
  if (!responses) sessionResponses.set(sessionHash, responses = new Set());
  responses.add(response);
  const timer = setTimeout(() => response.destroy(), Math.max(0, expiresAt - Date.now()));
  timer.unref();
  response.once("close", () => {
    clearTimeout(timer);
    responses.delete(response);
    if (!responses.size && sessionResponses.get(sessionHash) === responses) sessionResponses.delete(sessionHash);
  });
}

export function closeSessionResponses(sessionHash: string) {
  for (const response of sessionResponses.get(sessionHash) ?? []) response.destroy();
  sessionResponses.delete(sessionHash);
}
