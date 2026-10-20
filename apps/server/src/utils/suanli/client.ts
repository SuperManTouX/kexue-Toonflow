import { getAuthMode, getCurrentUser } from "@/lib/userContext";

const requestTimeout = 15000;
const maxResponseBytes = 10 * 1024 * 1024;

function failure(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function serviceUrl(value: string, name: string, allowPath = false) {
  if (!URL.canParse(value)) throw failure(`请检查 ${name} 配置`, 500);
  const url = new URL(value);
  const allowHttp = process.env.NODE_ENV === "dev";
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:"))) {
    throw failure(`${name} 必须使用 HTTPS 且不能包含账号、查询参数或锚点`, 500);
  }
  if (!allowPath && url.pathname !== "/") throw failure(`${name} 必须配置为基础域名`, 500);
  return url;
}

function suanliApiBase() {
  const base = serviceUrl(process.env.SUANLI_BASE_URL ?? "", "SUANLI_BASE_URL", true);
  const basePath = base.pathname.replace(/\/+$/, "");
  if (basePath && basePath !== "/suanli") throw failure("SUANLI_BASE_URL 必须配置为域名或 /suanli 路径", 500);
  return `${base.origin}/suanli/v1`;
}

function suanliUrl(path: string) {
  return new URL(`${suanliApiBase()}/${path.replace(/^\/+/, "")}`);
}

function aigcUrl(path: string) {
  const base = serviceUrl(process.env.AIGC_BASE_URL ?? "https://talkingdraw.xueai.art/aigc", "AIGC_BASE_URL", true);
  const basePath = base.pathname.replace(/\/+$/, "");
  return new URL(`${basePath}/${path.replace(/^\/+/, "")}`, base.origin);
}

function suanliToken() {
  if (getAuthMode() === "sxwz") {
    const token = getCurrentUser().suanliToken?.trim();
    if (!token || token.length > 8192) throw failure("当前会话缺少有效的 SXWZ 算力凭证，请重新登录", 401);
    return token;
  }
  const token = process.env.SUANLI_API_TOKEN?.trim();
  if (!token || token.length > 8192) throw failure("请配置有效的 SUANLI_API_TOKEN", 500);
  return token;
}

export function getSuanliRuntimeConfig() {
  return { apiUrl: suanliApiBase(), apiKey: suanliToken() };
}

async function readJson(response: Response, service: string) {
  const reader = response.body?.getReader();
  if (!reader) throw failure("上游响应为空", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel();
        throw failure("上游响应超过大小限制", 502);
      }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch (error) {
    if (error instanceof Error && "status" in error) throw error;
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw failure(`${service}响应读取超时`, 504);
    throw failure("上游返回的 JSON 格式无效", 502);
  } finally {
    reader.releaseLock();
  }
}

async function requestJson<T>(url: URL, init: RequestInit, service: string): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(requestTimeout)]) : AbortSignal.timeout(requestTimeout);
    response = await fetch(url, { ...init, headers, redirect: "error", signal });
  } catch (error) {
    init.signal?.throwIfAborted();
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    throw failure(timeout ? `${service}请求超时` : `${service}暂不可用`, timeout ? 504 : 502);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw failure(`${service}请求失败（HTTP ${response.status}）`, 502);
  }
  return await readJson(response, service) as T;
}

export function requestSuanliJson<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${suanliToken()}`);
  return requestJson<T>(suanliUrl(path), { ...init, headers }, "算力中台");
}

export function requestAigcJson<T>(path: string, init: RequestInit = {}) {
  return requestJson<T>(aigcUrl(path), init, "AIGC 配置服务");
}
