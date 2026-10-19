import axios from "axios";
import type { AxiosInstance } from "axios";
import { shallowRef, computed } from "vue";
import { setHostRequest } from "@toonflow/nodes-scaffold/hostRequest";
import type { HostRequest } from "@toonflow/nodes-scaffold/hostRequest";

type AuthState = { mode: "local" | "sxwz"; user: { id: string; name: string } | null };
export const authState = shallowRef<AuthState>({ mode: "sxwz", user: null });
export const canManageHost = computed(() => authState.value.mode === "local");
export class AuthRequiredError extends Error {}
const lifetime = new AbortController();
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("toonflowIdentity") : undefined;
channel?.addEventListener("message", event => {
  if (authState.value.mode === "sxwz" && authState.value.user && event.data?.userId !== authState.value.user.id) invalidateSession();
});

function invalidateSession() {
  if (lifetime.signal.aborted) return;
  lifetime.abort(new DOMException("登录状态已变化", "AbortError"));
  window.location.reload();
}
function isAppUrl(value: string | URL) {
  const url = new URL(value, window.location.href);
  return url.origin === location.origin && url.pathname.startsWith("/api/");
}
function sessionChanged(status: number, body?: { data?: { code?: string } }) {
  return status === 401 || (status === 409 && body?.data?.code === "EAUTHCHANGED");
}
export function getRequestHeaders(): Record<string, string> {
  return authState.value.user ? { "x-toonflow-user": authState.value.user.id } : {};
}
export function apiUrl(value: string) {
  const url = new URL(value, location.href);
  if (isAppUrl(url) && authState.value.user) url.searchParams.set("toonflowUser", authState.value.user.id);
  return `${url.pathname}${url.search}${url.hash}`;
}
export function registerApiAuth(client: AxiosInstance) {
  client.interceptors.request.use(config => {
    if (!isAppUrl(client.getUri(config))) return config;
    lifetime.signal.throwIfAborted();
    for (const [key, value] of Object.entries(getRequestHeaders())) config.headers.set(key, value);
    config.signal = config.signal ? AbortSignal.any([lifetime.signal, config.signal as AbortSignal]) : lifetime.signal;
    return config;
  });
  client.interceptors.response.use(response => { lifetime.signal.throwIfAborted(); return response; }, error => {
    if (isAppUrl(client.getUri(error.config ?? {})) && authState.value.mode === "sxwz" && authState.value.user && sessionChanged(error.response?.status, error.response?.data)) invalidateSession();
    return Promise.reject(error);
  });
}
registerApiAuth(axios);

export const appFetch: HostRequest = async (input, init) => {
  const url = input instanceof Request ? input.url : input;
  if (!isAppUrl(url)) return fetch(input, init);
  lifetime.signal.throwIfAborted();
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  for (const [key, value] of Object.entries(getRequestHeaders())) headers.set(key, value);
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const response = await fetch(input, { ...init, headers, signal: signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal });
  lifetime.signal.throwIfAborted();
  if (authState.value.mode === "sxwz" && authState.value.user && response.status === 401) invalidateSession();
  if (authState.value.mode === "sxwz" && authState.value.user && response.status === 409 && response.headers.get("content-type")?.includes("application/json")) {
    const body = await response.clone().json().catch(() => undefined);
    if (sessionChanged(response.status, body)) invalidateSession();
  }
  return response;
};
setHostRequest(appFetch);

export async function initializeAuth(externalToken: string | null) {
  try {
    if (externalToken !== null) {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sxwzToken: externalToken }) });
      const body = await response.json();
      if (!response.ok) throw new AuthRequiredError(body.message || "SXWZ 登录失败，请从平台重新进入");
    }
    const response = await fetch("/api/auth/get", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok || body.code !== 200 || !body.data || !["local", "sxwz"].includes(body.data.mode)) throw new Error("读取登录状态失败");
    authState.value = body.data;
    if (!authState.value.user) throw new AuthRequiredError("请从 SXWZ 平台进入 Toonflow");
    if (authState.value.mode === "sxwz") channel?.postMessage({ userId: authState.value.user.id });
    return authState.value;
  } finally { externalToken = null; }
}
export async function logout() {
  if (lifetime.signal.aborted) return;
  lifetime.abort(new DOMException("正在退出登录", "AbortError"));
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", headers: getRequestHeaders() });
    if (!response.ok) throw new Error("退出登录失败");
    channel?.postMessage({ userId: null });
  } finally { window.location.reload(); }
}
