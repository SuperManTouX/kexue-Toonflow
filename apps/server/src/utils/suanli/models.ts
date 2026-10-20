import { z } from "zod";
import type { SuanliIdentity } from "@/lib/userContext";
import { requestAigcJson, requestSuanliJson } from "./client";
import { suanliParamsSchema, type SuanliModel, type SuanliParam } from "./types";

const openModelListSchema = z.object({
  data: z.array(z.object({ id: z.string().trim().min(1).max(256), owned_by: z.string().optional() })),
});
const platformModelSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(256),
  display_name: z.string().trim().nullable().optional(),
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
const courseModelSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(256),
  display_name: z.string().nullable().optional(),
  kind: z.string().trim().min(1).max(128),
  category: z.string().trim().max(128).nullable().optional(),
  platform: z.object({ code: z.string().trim().min(1).max(128), name: z.string().trim().min(1).max(256) }),
});
const courseModelPageSchema = z.object({
  code: z.number().int(),
  data: z.object({
    models: z.array(courseModelSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(100),
  }),
});
const aigcEnvelopeSchema = z.object({ code: z.number().int(), data: z.unknown().optional() });
const aigcConfigSchema = z.object({
  modelId: z.uuid().optional(),
  platformId: z.string().trim().min(1).max(128).optional(),
  params: z.unknown(),
});
const pageSize = 100;
const templateBatchSize = 4;
const platformCodes = ["ai_chat", "ai_painting_talk", "ai_video_talk", "ai_music_talk"];
type AigcModelTemplate = { modelId?: string; platformId?: string; params: SuanliParam[] };

function failure(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function assertIdentity(identity?: SuanliIdentity): asserts identity is SuanliIdentity & { schoolId: string } {
  if (!identity?.userId || !identity.sessionId) throw failure("当前登录状态缺少算力身份，请重新登录", 401);
  if (!identity.schoolId) throw failure("SXWZ 登录身份未提供学校信息，无法读取课程模型", 403);
}

async function readOpenModels() {
  const body = await requestSuanliJson<unknown>("models");
  const parsed = openModelListSchema.safeParse(body);
  if (!parsed.success) throw failure("算力中台返回的模型列表格式无效", 502);
  return parsed.data.data;
}

async function readPlatformModels(schoolId: string, platformCode: string) {
  const query = new URLSearchParams({ school_id: schoolId });
  const body = await requestSuanliJson<unknown>(`platforms/${encodeURIComponent(platformCode)}/models?${query}`);
  const parsed = platformModelListSchema.safeParse(body);
  if (!parsed.success || parsed.data.code !== 0 || parsed.data.data.platform.code !== platformCode) {
    throw failure("算力中台返回的平台模型列表格式无效", 502);
  }
  return parsed.data.data;
}

async function readCourseModelPage(schoolId: string, platformCode: string, page: number) {
  const query = new URLSearchParams({ school_id: schoolId, platform: platformCode, page: String(page), pageSize: String(pageSize) });
  const body = await requestSuanliJson<unknown>(`platforms/course-models?${query}`);
  const parsed = courseModelPageSchema.safeParse(body);
  if (!parsed.success || parsed.data.code !== 0 || parsed.data.data.page !== page) {
    throw failure("算力中台返回的课程模型列表格式无效", 502);
  }
  return parsed.data.data;
}

async function readCourseModels(schoolId: string, platformCode: string) {
  const firstPage = await readCourseModelPage(schoolId, platformCode, 1);
  const pageCount = Math.ceil(firstPage.total / pageSize);
  // ACT: 最多读取 10000 条课程模型，避免异常 total 导致无界分页；更大目录需要评估分页和缓存策略。
  if (pageCount > 100) throw failure("课程模型数量超过当前目录上限", 502);
  const models = [...firstPage.models];
  for (let page = 2; page <= pageCount; page++) {
    const result = await readCourseModelPage(schoolId, platformCode, page);
    if (result.total !== firstPage.total) throw failure("课程模型目录在分页读取期间发生变化", 502);
    models.push(...result.models);
  }
  if (models.length !== firstPage.total) throw failure("算力中台返回的课程模型分页不完整", 502);
  if (models.some(model => model.platform.code !== platformCode)) throw failure("算力中台返回了不匹配的平台课程模型", 502);
  return models;
}

async function readCatalog(identity: SuanliIdentity) {
  assertIdentity(identity);
  const [openModels, platformLists, courseLists] = await Promise.all([
    readOpenModels(),
    Promise.all(platformCodes.map(platformCode => readPlatformModels(identity.schoolId, platformCode))),
    Promise.all(platformCodes.map(platformCode => readCourseModels(identity.schoolId, platformCode))),
  ]);
  const modelsByKey = new Map(openModels.map(model => [model.id, model]));
  const modelsByRef = new Map<string, SuanliModel>();
  function addModel(model: SuanliModel) {
    const previous = modelsByRef.get(model.modelRef);
    modelsByRef.set(model.modelRef, {
      ...previous,
      ...model,
      kind: model.platformCode === "ai_chat" ? "llm" : model.kind,
      category: model.category || previous?.category,
      platformCode: model.platformCode,
      platformName: model.platformName,
    });
  }
  for (const platformList of platformLists) {
    for (const model of platformList.models) {
      const openModel = modelsByKey.get(model.name);
      addModel({
        providerId: "suanli",
        modelRef: `${platformList.platform.code}:${model.id}`,
        modelId: model.id,
        label: model.display_name?.trim() || model.name,
        kind: model.kind,
        ...((model.category || openModel?.owned_by) ? { category: model.category || openModel?.owned_by } : {}),
        platformCode: platformList.platform.code,
        platformName: platformList.platform.name,
      });
    }
  }
  for (const courseList of courseLists) {
    for (const courseModel of courseList) {
      const openModel = modelsByKey.get(courseModel.name);
      addModel({
        providerId: "suanli",
        modelRef: `${courseModel.platform.code}:${courseModel.id}`,
        modelId: courseModel.id,
        label: courseModel.display_name?.trim() || courseModel.name,
        kind: courseModel.kind,
        ...((courseModel.category || openModel?.owned_by) ? { category: courseModel.category || openModel?.owned_by } : {}),
        platformCode: courseModel.platform.code,
        platformName: courseModel.platform.name,
      });
    }
  }
  return [...modelsByRef.values()];
}

function parseModelRef(value: string) {
  const separator = value.indexOf(":");
  const platformCode = value.slice(0, separator);
  const modelId = value.slice(separator + 1);
  if (separator <= 0 || !platformCodes.includes(platformCode) || !z.uuid().safeParse(modelId).success) {
    throw failure("算力模型标识无效", 400);
  }
  return { platformCode, modelId };
}

function readModelTemplate(value: unknown): AigcModelTemplate | undefined {
  const config = aigcConfigSchema.safeParse(value);
  if (!config.success) return;
  const params = suanliParamsSchema.safeParse(config.data.params);
  return params.success ? { ...config.data, params: params.data } : undefined;
}

async function readBatchParams(modelIds: string[]): Promise<Map<string, AigcModelTemplate>> {
  const templates = new Map<string, AigcModelTemplate>();
  for (let index = 0; index < modelIds.length; index += templateBatchSize) {
    const batch = modelIds.slice(index, index + templateBatchSize);
    const body = await requestAigcJson<unknown>("open/models/configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelIds: batch }),
    });
    const parsed = aigcEnvelopeSchema.extend({ data: z.record(z.string(), z.unknown()) }).safeParse(body);
    if (!parsed.success || parsed.data.code !== 0) throw failure("AIGC 模型模板暂不可用", 502);
    for (const [modelId, config] of Object.entries(parsed.data.data)) {
      const template = readModelTemplate(config);
      if (template && (!template.modelId || template.modelId === modelId)) templates.set(modelId, template);
    }
  }
  return templates;
}

export async function listSuanliModels(identity?: SuanliIdentity) {
  assertIdentity(identity);
  const models = await readCatalog(identity);
  const templatesByModelId = await readBatchParams([...new Set(models.map(model => model.modelId))]);
  return models.map(model => {
    const template = templatesByModelId.get(model.modelId);
    const params = template && (!template.platformId || template.platformId === model.platformCode) ? template.params : undefined;
    return params ? { ...model, params } : model;
  });
}

export async function getSuanliModelByRef(modelRef: string, identity?: SuanliIdentity) {
  assertIdentity(identity);
  parseModelRef(modelRef);
  const model = (await readCatalog(identity)).find(item => item.modelRef === modelRef);
  if (!model) throw failure("所选模型不在当前账号的算力模型目录中", 404);
  return model;
}

export async function getSuanliModelConfig(modelRef: string, identity?: SuanliIdentity) {
  const model = await getSuanliModelByRef(modelRef, identity);
  return readModelConfig(model);
}

async function readModelConfig(model: SuanliModel) {
  const path = `open/models/${encodeURIComponent(model.modelId)}/config`;
  const body = await requestAigcJson<unknown>(path);
  const parsed = aigcEnvelopeSchema.safeParse(body);
  if (!parsed.success) throw failure("AIGC 模型模板格式无效", 502);
  if (parsed.data.code !== 0) throw failure("该模型没有可用的请求模板", 404);
  const template = readModelTemplate(parsed.data.data);
  if (!template || template.modelId && template.modelId !== model.modelId) throw failure("该模型的请求模板包含无效字段", 502);
  if (template.platformId && template.platformId !== model.platformCode) throw failure("该模型没有可用的请求模板", 404);
  return template.params;
}

export async function getSuanliModelWithConfig(modelRef: string, identity?: SuanliIdentity) {
  assertIdentity(identity);
  parseModelRef(modelRef);
  const model = (await readCatalog(identity)).find(item => item.modelRef === modelRef);
  if (!model) throw failure("所选模型不在当前账号的算力模型目录中", 404);
  return { model, params: await readModelConfig(model) };
}
