import { shallowRef } from "vue";
import { appFetch } from "@/lib/auth";
import type { SuanliModel, SuanliParam } from "@toonflow/server/suanli/types";

export const suanliModels = shallowRef<SuanliModel[]>([]);
export const suanliModelsLoaded = shallowRef(false);
let modelRequest: Promise<SuanliModel[]> | undefined;

type ApiEnvelope<T> = { code?: number; data?: T; message?: string };
export type SuanliTaskStatus = "queued" | "processing" | "completed" | "failed" | "cancelled" | "timeout" | "unavailable";
export type SuanliTask = {
  taskId?: string;
  clientTaskId?: string;
  status: SuanliTaskStatus;
  position?: number;
  result?: unknown;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
};
export type SuanliTaskSession = { directory: string; sessionFile?: string; messageId: string };
export type CreatedSuanliTask = SuanliTask & { taskId: string; clientTaskId: string; sessionFile: string; messageId: string };
export type SuanliModelConfig = { params: SuanliParam[]; imageUploadAvailable: boolean };

async function readResponse<T>(response: Response): Promise<ApiEnvelope<T>> {
  const body = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || body?.code !== 200) throw new Error(body?.message || "算力服务请求失败");
  return body;
}

export async function refreshSuanliModels() {
  if (modelRequest) return modelRequest;
  modelRequest = (async () => {
    try {
      const body = await readResponse<unknown>(await appFetch("/api/suanli/models", { cache: "no-store" }));
      if (!Array.isArray(body.data)) throw new Error("算力模型列表格式无效");
      suanliModels.value = body.data as SuanliModel[];
      suanliModelsLoaded.value = true;
      return suanliModels.value;
    } catch (error) {
      suanliModelsLoaded.value = false;
      throw error;
    } finally { modelRequest = undefined; }
  })();
  return modelRequest;
}

export function getSuanliModel(value: string) {
  return suanliModels.value.find(model => model.modelRef === value);
}

export async function refreshSuanliModelConfig(modelRef: string) {
  const body = await readResponse<unknown>(await appFetch(`/api/suanli/models/${encodeURIComponent(modelRef)}/config`, { cache: "no-store" }));
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) throw new Error("模型请求模板格式无效");
  const config = body.data as Partial<SuanliModelConfig>;
  if (!Array.isArray(config.params) || typeof config.imageUploadAvailable !== "boolean") throw new Error("模型请求模板格式无效");
  return config as SuanliModelConfig;
}

export async function uploadSuanliImage(file: File, signal: AbortSignal, contentType = file.type) {
  const response = await appFetch("/api/suanli/upload", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-File-Content-Type": contentType },
    body: file,
    signal,
  });
  const body = await readResponse<{ url?: string }>(response);
  if (typeof body.data?.url !== "string") throw new Error("图片上传响应格式无效");
  return body.data.url;
}

export async function createSuanliTask(modelRef: string, values: Record<string, unknown>, session: SuanliTaskSession) {
  const response = await appFetch("/api/suanli/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body: JSON.stringify({ modelRef, body: values, ...session }),
  });
  const body = await response.json().catch(() => null) as ApiEnvelope<Partial<CreatedSuanliTask>> | null;
  if (!response.ok || body?.code !== 200 || !body.data) {
    const clientTaskId = body?.data && typeof body.data === "object" && "clientTaskId" in body.data
      && typeof body.data.clientTaskId === "string" ? body.data.clientTaskId : undefined;
    const sessionFile = body?.data && typeof body.data === "object" && "sessionFile" in body.data
      && typeof body.data.sessionFile === "string" ? body.data.sessionFile : undefined;
    throw Object.assign(new Error(body?.message || "提交算力任务失败"), { clientTaskId, sessionFile });
  }
  if (typeof body.data.sessionFile !== "string" || body.data.sessionFile.length === 0) throw new Error("任务对话记录响应无效");
  return body.data as CreatedSuanliTask;
}

export async function getSuanliTask(taskId: string, session: SuanliTaskSession & { sessionFile: string }) {
  const query = new URLSearchParams({ directory: session.directory, sessionFile: session.sessionFile, messageId: session.messageId });
  const body = await readResponse<SuanliTask>(await appFetch(`/api/suanli/tasks/${encodeURIComponent(taskId)}?${query}`, {
    cache: "no-store", headers: { "x-toonflow-workspace": "1" },
  }));
  if (!body.data) throw new Error("任务状态响应为空");
  return body.data;
}

export async function cancelSuanliTask(taskId: string) {
  const body = await readResponse<SuanliTask>(await appFetch(`/api/suanli/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST" }));
  if (!body.data) throw new Error("任务取消响应为空");
  return body.data;
}
