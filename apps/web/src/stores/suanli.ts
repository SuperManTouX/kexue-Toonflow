import { computed, ref } from "vue";
import type { SuanliModel } from "@toonflow/server/suanli/types";
import { appFetch } from "@/lib/auth";
import { isDesktop, isRemoteConnection } from "@/lib/platform";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/nodeAi";

type SuanliUser = { id: string; name: string };
type SuanliCaptcha = { captchaId: string; captchaImage: string };
type ApiResponse<T> = { code: number; data: T; message: string };
class SuanliRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export const suanliAvailable = isDesktop && !isRemoteConnection;
export const suanliUser = ref<SuanliUser | null>(null);
export const suanliModels = ref<SuanliModel[]>([]);
export const suanliStatusReady = ref(false);
export const suanliLoading = ref(false);
export const suanliError = ref("");

let statusRequest: Promise<void> | undefined;
let modelRequest: Promise<SuanliModel[]> | undefined;
let catalogRevision = 0;

function refreshMediaModelCatalog() {
  invalidateNodeModels("media");
  if (typeof window !== "undefined") window.dispatchEvent(new Event("toonflow:provider-config-changed"));
}

async function readApiResponse<T>(path: string, init?: RequestInit) {
  const response = await appFetch(path, init);
  const body = await response.json().catch(() => undefined) as ApiResponse<T> | undefined;
  if (!response.ok || !body || body.code !== 200) {
    throw new SuanliRequestError(body && typeof body.message === "string" ? body.message : "SXWZ 算力请求失败", response.status);
  }
  return body.data;
}

export const suanliModelChoices = computed(() => suanliModels.value
  .filter(model => (model.platformCode === "ai_chat" || model.platformCode === "ai_coding") && model.kind === "llm")
  .map(model => ({
    value: JSON.stringify(["suanli", model.modelRef]), providerId: "suanli", modelId: model.modelRef, label: model.label,
    contextWindow: 262144, platformCode: model.platformCode, platformName: model.platformName,
  })));

export const agentModelChoices = suanliModelChoices;

export const suanliModelGroups = computed(() => {
  const groups = new Map<string, { id: string; label: string; models: { id: string; label: string; providerId: string }[] }>();
  for (const model of suanliModels.value) {
    if (!(model.platformCode === "ai_chat" || model.platformCode === "ai_coding") || model.kind !== "llm") continue;
    const id = `suanli:${model.platformCode}`;
    const group = groups.get(id) ?? { id, label: model.platformName, models: [] };
    group.models.push({ id: model.modelRef, label: model.label, providerId: "suanli" });
    groups.set(id, group);
  }
  return [...groups.values()];
});

export const agentModelGroups = suanliModelGroups;

export async function refreshSuanliModels() {
  if (!suanliAvailable || !suanliUser.value) {
    suanliModels.value = [];
    return [];
  }
  if (modelRequest) return modelRequest;
  const revision = catalogRevision;
  suanliLoading.value = true;
  suanliError.value = "";
  let request = Promise.resolve([] as SuanliModel[]);
  request = (async () => {
    try {
      const models = await readApiResponse<SuanliModel[]>("/api/suanli/models", { cache: "no-store" });
      if (!Array.isArray(models)) throw new Error("算力模型目录格式无效");
      if (revision === catalogRevision && suanliUser.value) suanliModels.value = models;
      return models;
    } catch (error) {
      if (revision === catalogRevision) {
        suanliError.value = error instanceof Error ? error.message : "读取算力模型失败";
        if (error instanceof SuanliRequestError && error.status === 401) {
          catalogRevision++;
          modelRequest = undefined;
          suanliLoading.value = false;
          suanliUser.value = null;
          suanliModels.value = [];
          refreshMediaModelCatalog();
        }
      }
      throw error;
    } finally {
      if (modelRequest === request) {
        modelRequest = undefined;
        suanliLoading.value = false;
      }
    }
  })();
  modelRequest = request;
  return request;
}

export async function loadSuanliStatus() {
  if (!suanliAvailable) return;
  if (statusRequest) return statusRequest;
  const revision = catalogRevision;
  let request = Promise.resolve();
  request = (async () => {
    try {
      const result = await readApiResponse<{ user: SuanliUser | null }>("/api/suanli/auth/get", { cache: "no-store" });
      if (revision === catalogRevision) {
        suanliUser.value = result?.user ?? null;
        suanliStatusReady.value = true;
        if (suanliUser.value) await refreshSuanliModels();
        else suanliModels.value = [];
      }
    } catch (error) {
      if (revision === catalogRevision) {
        suanliStatusReady.value = true;
        suanliError.value = error instanceof Error ? error.message : "读取 SXWZ 登录状态失败";
      }
      throw error;
    } finally {
      if (statusRequest === request) statusRequest = undefined;
    }
  })();
  statusRequest = request;
  return request;
}

export async function loadSuanliCaptcha() {
  return readApiResponse<SuanliCaptcha>("/api/suanli/auth/captcha", { cache: "no-store" });
}

export async function loginSuanli(username: string, password: string, captchaId: string, captchaValue: string) {
  suanliError.value = "";
  const result = await readApiResponse<{ user: SuanliUser }>("/api/suanli/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, captchaId, captchaValue }),
  });
  if (!result?.user?.id || !result.user.name) throw new Error("SXWZ 登录响应格式无效");
  catalogRevision++;
  modelRequest = undefined;
  statusRequest = undefined;
  suanliLoading.value = false;
  suanliUser.value = result.user;
  suanliStatusReady.value = true;
  suanliModels.value = [];
  refreshMediaModelCatalog();
  await refreshSuanliModels().catch(() => {});
  return result.user;
}

export async function logoutSuanli() {
  await readApiResponse<null>("/api/suanli/auth/logout", { method: "POST" });
  catalogRevision++;
  modelRequest = undefined;
  statusRequest = undefined;
  suanliLoading.value = false;
  suanliUser.value = null;
  suanliModels.value = [];
  refreshMediaModelCatalog();
  suanliError.value = "";
  suanliStatusReady.value = true;
}
