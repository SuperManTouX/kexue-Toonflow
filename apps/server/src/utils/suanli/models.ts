import { z } from "zod";
import { getSuanliSession } from "./auth";
import { requestSuanliJson } from "./client";
import type { SuanliIdentity } from "./auth";
import type { SuanliModel } from "./types";

const supportedPlatformCodes = ["ai_chat", "ai_coding", "ai_painting_talk"];
const platformListSchema = z.object({
  code: z.number().int(),
  data: z.object({
    platforms: z.array(z.object({ code: z.string().trim().min(1).max(128), name: z.string().trim().min(1).max(256) })).max(1000),
  }),
});
const platformModelSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(256),
  display_name: z.string().trim().max(256).nullable().optional(),
  kind: z.string().trim().min(1).max(128),
  category: z.string().trim().max(128).nullable().optional(),
});
const platformModelListSchema = z.object({
  code: z.number().int(),
  data: z.object({
    platform: z.object({ code: z.string().trim().min(1).max(128), name: z.string().trim().min(1).max(256) }),
    models: z.array(platformModelSchema).max(10000),
  }),
});
const cacheLifetime = 60000;
let cache: { key: string; expiresAt: number; models: SuanliModel[] } | undefined;

function failure(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function requireSession() {
  const session = getSuanliSession();
  if (!session) throw failure("请先登录 SXWZ 算力账号", 401);
  if (!session.identity.userId || !session.identity.sessionId || !session.identity.schoolId) {
    throw failure("SXWZ 登录身份缺少算力所需字段，请重新登录", 401);
  }
  return session;
}

function identityCacheKey(identity: SuanliIdentity) {
  return [identity.userId, identity.sessionId, identity.schoolId, identity.collegeId ?? ""].join("\0");
}

async function readPlatformModels(identity: SuanliIdentity, code: string, name: string, session: NonNullable<ReturnType<typeof getSuanliSession>>) {
  const query = new URLSearchParams({ school_id: identity.schoolId });
  if (identity.collegeId) query.set("college_id", identity.collegeId);
  const body = await requestSuanliJson<unknown>(`platforms/${encodeURIComponent(code)}/models?${query}`, {}, session);
  const parsed = platformModelListSchema.safeParse(body);
  if (!parsed.success || parsed.data.code !== 0 || parsed.data.data.platform.code !== code) {
    throw failure("算力中台返回的平台模型列表格式无效", 502);
  }
  const seen = new Set<string>();
  return parsed.data.data.models.map(model => {
    if (seen.has(model.id)) throw failure("算力中台返回了重复模型", 502);
    seen.add(model.id);
    return {
      providerId: "suanli" as const,
      modelRef: `${code}:${model.id}`,
      modelId: model.id,
      label: model.display_name?.trim() || model.name,
      kind: model.kind,
      ...(model.category ? { category: model.category } : {}),
      platformCode: code,
      platformName: name,
    };
  });
}

export function clearSuanliModelCache() {
  cache = undefined;
}

export async function listSuanliModels() {
  const session = requireSession();
  const identity = session.identity;
  const key = identityCacheKey(identity);
  if (cache?.key === key && cache.expiresAt > Date.now()) return cache.models.map(model => ({ ...model }));
  const body = await requestSuanliJson<unknown>("platforms/list", {}, session);
  const parsed = platformListSchema.safeParse(body);
  if (!parsed.success || parsed.data.code !== 0) throw failure("算力中台返回的平台列表格式无效", 502);
  const platformMap = new Map(parsed.data.data.platforms.map(platform => [platform.code, platform.name]));
  if (platformMap.size !== parsed.data.data.platforms.length) throw failure("算力中台返回了重复平台", 502);
  const enabled = supportedPlatformCodes.filter(code => platformMap.has(code));
  const models = (await Promise.all(enabled.map(code => readPlatformModels(identity, code, platformMap.get(code)!, session)))).flat();
  cache = { key, expiresAt: Date.now() + cacheLifetime, models };
  return models.map(model => ({ ...model }));
}

function parseModelRef(value: string) {
  const separator = value.indexOf(":");
  const platformCode = value.slice(0, separator);
  const modelId = value.slice(separator + 1);
  if (separator <= 0 || !supportedPlatformCodes.includes(platformCode) || !z.uuid().safeParse(modelId).success) {
    throw failure("算力模型标识无效", 400);
  }
  return { platformCode, modelId };
}

export async function getSuanliModelByRef(modelRef: string) {
  const parsed = parseModelRef(modelRef);
  const model = (await listSuanliModels()).find(item => item.modelRef === modelRef);
  if (!model || model.platformCode !== parsed.platformCode || model.modelId !== parsed.modelId) {
    throw failure("所选模型不在当前账号的算力模型目录中", 404);
  }
  return model;
}
