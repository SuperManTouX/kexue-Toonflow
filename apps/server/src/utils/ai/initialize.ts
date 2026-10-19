import tfRouter from "@toonflow/providers/language/tfRouter";
import tfRouterMedia from "@toonflow/providers/media/tfRouter";
import getConfig from "@/utils/conf";
import { getCurrentUser } from "@/lib/userContext";
import { fetchProviderModels } from "@/utils/ai/models";
import { getMediaProviderApiKey, refreshMediaProviderModels } from "@/utils/media/provider";

const initializations = new Map<string, Promise<void>>();

function normalizeApiKey(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/^Bearer(?:\s+|$)/i, "").trim() : "";
}

function getLanguageProvider(settings: Record<string, unknown>) {
  const providers = settings.customProviders;
  if (!Array.isArray(providers)) return;
  return providers.find(item => typeof item?.id === "string" && item.id.toLowerCase() === tfRouter.id.toLowerCase()
    && typeof item.apiUrl === "string" && URL.canParse(item.apiUrl) && new URL(item.apiUrl).origin === new URL(tfRouter.apiUrl).origin);
}

async function refreshLanguageModels(previousSettings?: Record<string, unknown>) {
  const provider = getLanguageProvider(getConfig().get("settings", {}));
  const apiKey = normalizeApiKey(provider?.apiKey);
  if (!apiKey || (previousSettings && apiKey === normalizeApiKey(getLanguageProvider(previousSettings)?.apiKey))) return;
  const models = await fetchProviderModels({ apiUrl: provider.apiUrl, protocol: provider.protocol, apiKey });
  if (!models.length) throw new Error("未获取到文本模型，保留原有列表");
  const current = getConfig().get("settings.customProviders");
  if (!Array.isArray(current)) return;
  const index = current.findIndex(item => item?.id === provider.id && item.apiUrl === provider.apiUrl
    && item.protocol === provider.protocol && item.apiKey === provider.apiKey);
  if (index === -1) return;
  const providers = current.map((item, itemIndex) => itemIndex === index ? { ...item, models } : item);
  getConfig().set("settings.customProviders", providers);
  return providers;
}

async function refreshMediaModels(previousSettings: Record<string, unknown> | undefined, errors: string[]) {
  const apiKey = getMediaProviderApiKey(tfRouterMedia.id);
  const configs = previousSettings?.mediaProviderConfigs as Record<string, { apiKey?: unknown }> | undefined;
  if (!apiKey || (previousSettings && apiKey === normalizeApiKey(configs?.[tfRouterMedia.id]?.apiKey))) return;
  let provider: Awaited<ReturnType<typeof refreshMediaProviderModels>> | undefined;
  // ACT: 同一供应商文件按类型串行保存，避免多个刷新读取相同版本后互相冲突。
  for (const type of ["video", "image", "audio"] as const) {
    if (getMediaProviderApiKey(tfRouterMedia.id) !== apiKey) break;
    try { provider = await refreshMediaProviderModels(`${tfRouterMedia.id}.ts`, undefined, type, apiKey); }
    catch (error) {
      if (getMediaProviderApiKey(tfRouterMedia.id) !== apiKey) break;
      errors.push(`TF-Router ${{ video: "视频", image: "图片", audio: "音频" }[type]}模型更新失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }
  return provider;
}

export async function refreshProviderModels(previousSettings?: Record<string, unknown>) {
  const errors: string[] = [];
  const [language, media] = await Promise.allSettled([refreshLanguageModels(previousSettings), refreshMediaModels(previousSettings, errors)]);
  for (const [result, label] of [[language, "文本"], [media, "媒体"]] as const) {
    if (result.status === "rejected") errors.push(`TF-Router ${label}模型更新失败：${result.reason instanceof Error ? result.reason.message : "未知错误"}`);
  }
  return {
    ...(language.status === "fulfilled" && language.value ? { customProviders: getConfig().get("settings.customProviders") as typeof language.value } : {}),
    ...(media.status === "fulfilled" && media.value ? { mediaProvider: media.value } : {}),
    ...(errors.length ? { modelRefreshErrors: errors } : {}),
  };
}

export default function initializeProviderModels() {
  const userId = getCurrentUser().userId;
  let initialization = initializations.get(userId);
  if (initialization) return initialization;
  initialization = refreshProviderModels().then(result => {
    result.modelRefreshErrors?.forEach(error => console.warn(error));
  });
  initializations.set(userId, initialization);
  return initialization;
}
