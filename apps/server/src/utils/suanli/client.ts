import { clearSuanliSession, getSuanliSession, getSuanliSessionRevision, getSxwzBaseUrl } from "./auth";

const requestTimeout = 15000;
const maxResponseBytes = 10 * 1024 * 1024;

function failure(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function suanliApiBase() {
  return `${getSxwzBaseUrl()}/suanli/v1`;
}

async function readJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw failure("算力中台响应为空", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel();
        throw failure("算力中台响应超过大小限制", 502);
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
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw failure("算力中台响应读取超时", 504);
    throw failure("算力中台返回的 JSON 格式无效", 502);
  } finally {
    reader.releaseLock();
  }
}

export async function requestSuanliJson<T>(path: string, init: RequestInit = {}, expectedSession?: NonNullable<ReturnType<typeof getSuanliSession>>): Promise<T> {
  const sessionRevision = getSuanliSessionRevision();
  const session = getSuanliSession();
  if (!session) throw failure("请先登录 SXWZ 算力账号", 401);
  if (expectedSession && (session.token !== expectedSession.token || JSON.stringify(session.identity) !== JSON.stringify(expectedSession.identity))) {
    throw failure("SXWZ 登录状态已变化，请重新读取模型目录", 409);
  }
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${session.token}`);
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(requestTimeout)]) : AbortSignal.timeout(requestTimeout);
    response = await fetch(new URL(`${suanliApiBase()}/${path.replace(/^\/+/, "")}`), { ...init, headers, redirect: "error", signal });
  } catch (error) {
    init.signal?.throwIfAborted();
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    throw failure(timeout ? "算力中台请求超时" : "算力中台暂不可用", timeout ? 504 : 502);
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401) await clearSuanliSession(sessionRevision);
    const status = response.status === 401 ? 401 : response.status === 403 ? 403 : 502;
    const message = response.status === 401 ? "SXWZ 登录凭据已失效，请重新登录"
      : response.status === 403 ? "当前 SXWZ 账号或应用无权访问算力接口" : `算力中台请求失败（HTTP ${response.status}）`;
    throw failure(message, status);
  }
  return await readJson(response) as T;
}

export function getSuanliRuntimeConfig() {
  const session = getSuanliSession();
  if (!session) throw failure("请先登录 SXWZ 算力账号", 401);
  return { apiUrl: suanliApiBase(), apiKey: session.token };
}
