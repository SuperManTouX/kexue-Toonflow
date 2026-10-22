import { z } from "zod";
import { getSuanliSession } from "./auth";
import { requestSuanliJson } from "./client";
import { recordSuanliFailure } from "./log";
import type { SuanliIdentity } from "./auth";
import type { SuanliModel } from "./types";

export const suanliMediaCapabilityTags = {
  textToImage: "文生图",
  imageToImage: "图片编辑",
  textToVideo: "文生视频",
  imageToVideo: "图生视频",
  firstLastFrame: "首尾帧",
} as const;

const supportedPlatformCodes = ["ai_chat", "ai_coding", "ai_painting_talk", "ai_video_talk", "ai_music_talk"];
const allowedMediaCapabilityTags = new Set<string>(Object.values(suanliMediaCapabilityTags));
const modelTagsSchema = z.union([
  z.array(z.string().max(128)).max(100),
  z.record(z.string().max(128), z.unknown()).refine(value => Object.keys(value).length <= 100),
]).nullish();
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
  billing_unit: z.string().trim().max(128).nullable().optional(),
  billing_mode: z.string().trim().max(128).nullable().optional(),
  unit_price: z.union([z.string().max(128), z.number().finite()]).nullable().optional(),
  input_price: z.union([z.string().max(128), z.number().finite()]).nullable().optional(),
  output_price: z.union([z.string().max(128), z.number().finite()]).nullable().optional(),
  cache_hit_price: z.union([z.string().max(128), z.number().finite()]).nullable().optional(),
  pre_frozen_amount: z.union([z.string().max(128), z.number().finite()]).nullable().optional(),
  sort_order: z.number().int().optional(),
  source_type: z.string().trim().max(128).nullable().optional(),
  tags: modelTagsSchema,
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

function parseModelTags(value: z.infer<typeof modelTagsSchema>) {
  if (Array.isArray(value)) return value;
  if (!value) return undefined;
  const tags = Object.entries(value).flatMap(([key, tag]) => {
    if (tag === true) return [key];
    if (typeof tag === "string" && tag.length <= 128) return [tag];
    return Array.isArray(tag) ? tag.filter((item): item is string => typeof item === "string" && item.length <= 128) : [];
  });
  return [...new Set(tags)].slice(0, 100);
}

async function readPlatformModels(identity: SuanliIdentity, code: string, name: string, session: NonNullable<ReturnType<typeof getSuanliSession>>) {
  const startedAt = Date.now();
  const query = new URLSearchParams({ school_id: identity.schoolId });
  if (identity.collegeId) query.set("college_id", identity.collegeId);
  const body = await requestSuanliJson<unknown>(`platforms/${encodeURIComponent(code)}/models?${query}`, {}, session);
  const parsed = platformModelListSchema.safeParse(body);
  if (!parsed.success || parsed.data.code !== 0 || parsed.data.data.platform.code !== code) {
    await recordSuanliFailure({ path: `platforms/${code}/models`, method: "GET", phase: "validation", reason: "invalid_model_catalog", status: 502, upstreamStatus: 200, durationMs: Date.now() - startedAt });
    throw failure("算力中台返回的平台模型列表格式无效", 502);
  }
  const seen = new Set<string>();
  for (const model of parsed.data.data.models) {
    if (seen.has(model.id)) {
      await recordSuanliFailure({ path: `platforms/${code}/models`, method: "GET", phase: "validation", reason: "duplicate_model", status: 502, upstreamStatus: 200, durationMs: Date.now() - startedAt });
      throw failure("算力中台返回了重复模型", 502);
    }
    seen.add(model.id);
  }
  return parsed.data.data.models.flatMap(model => {
    const tags = parseModelTags(model.tags);
    const isTextModel = model.kind.toLowerCase() === "llm" || model.category?.toLowerCase() === "llm";
    const mediaTags = tags?.filter(tag => allowedMediaCapabilityTags.has(tag));
    if (!isTextModel && !mediaTags?.length) return [];
    return [{
      providerId: "suanli" as const,
      modelRef: `${code}:${model.id}`,
      modelId: model.id,
      label: model.display_name?.trim() || model.name,
      kind: model.kind,
      ...(model.category ? { category: model.category } : {}),
      platformCode: code,
      platformName: name,
      ...(model.billing_unit ? { billingUnit: model.billing_unit } : {}),
      ...(model.billing_mode ? { billingMode: model.billing_mode } : {}),
      ...(model.unit_price != null ? { unitPrice: model.unit_price } : {}),
      ...(model.input_price != null ? { inputPrice: model.input_price } : {}),
      ...(model.output_price != null ? { outputPrice: model.output_price } : {}),
      ...(model.cache_hit_price != null ? { cacheHitPrice: model.cache_hit_price } : {}),
      ...(model.pre_frozen_amount != null ? { preFrozenAmount: model.pre_frozen_amount } : {}),
      ...(model.sort_order !== undefined ? { sortOrder: model.sort_order } : {}),
      ...(model.source_type ? { sourceType: model.source_type } : {}),
      ...(tags?.length ? { tags: isTextModel ? tags : mediaTags } : {}),
    }];
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
  const startedAt = Date.now();
  const body = await requestSuanliJson<unknown>("platforms/list", {}, session);
  const parsed = platformListSchema.safeParse(body);
  if (!parsed.success || parsed.data.code !== 0) {
    await recordSuanliFailure({ path: "platforms/list", method: "GET", phase: "validation", reason: "invalid_platform_catalog", status: 502, upstreamStatus: 200, durationMs: Date.now() - startedAt });
    throw failure("算力中台返回的平台列表格式无效", 502);
  }
  const platformMap = new Map(parsed.data.data.platforms.map(platform => [platform.code, platform.name]));
  if (platformMap.size !== parsed.data.data.platforms.length) {
    await recordSuanliFailure({ path: "platforms/list", method: "GET", phase: "validation", reason: "duplicate_platform", status: 502, upstreamStatus: 200, durationMs: Date.now() - startedAt });
    throw failure("算力中台返回了重复平台", 502);
  }
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
