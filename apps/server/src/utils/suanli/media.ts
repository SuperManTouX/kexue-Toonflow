import { z } from "zod";
import { getSuanliSession } from "./auth";
import { requestSuanliJson } from "./client";
import { recordSuanliFailure } from "./log";
import type { SuanliMediaParam, SuanliMediaTemplate } from "./types";
import { getSuanliModelByRef, getSuanliModelMediaTypes } from "./models";

const baseParam = {
  name: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(128),
  required: z.boolean().optional(),
  showWhen: z.record(z.string().trim().min(1).max(128), z.union([z.string().max(4096), z.number().finite(), z.boolean()]))
    .refine(conditions => Object.keys(conditions).length <= 100).optional(),
};
const numberParamSchema = z.object({
  ...baseParam,
  ui: z.literal("number"),
  default: z.number().finite().optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
}).superRefine((param, context) => {
  if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
    context.addIssue({ code: "custom", path: ["max"], message: "数值参数最小值不能大于最大值" });
  }
  if (param.default !== undefined && (param.min !== undefined && param.default < param.min
    || param.max !== undefined && param.default > param.max)) {
    context.addIssue({ code: "custom", path: ["default"], message: "数值参数默认值超出模板边界" });
  }
});
const mediaParamSchema = z.discriminatedUnion("ui", [
  z.object({ ...baseParam, ui: z.literal("textarea"), default: z.string().optional(), maxLength: z.number().int().positive().max(20000).optional() }),
  numberParamSchema,
  z.object({ ...baseParam, ui: z.enum(["proportion", "resolution", "select"]), default: z.union([z.string(), z.number().finite()]).optional(), options: z.array(z.union([z.string().min(1).max(256), z.number().finite()])).min(1).max(100) }),
  z.object({ ...baseParam, ui: z.literal("quantity"), default: z.number().finite().optional(), options: z.array(z.number().finite()).min(1).max(100) }),
  z.object({
    ...baseParam,
    ui: z.literal("dimension"),
    default: z.string().optional(),
    dimension: z.object({
      width: z.object({ min: z.number().finite().optional(), max: z.number().finite().optional() }).optional(),
      height: z.object({ min: z.number().finite().optional(), max: z.number().finite().optional() }).optional(),
      separator: z.string().min(1).max(8),
    }),
  }),
  z.object({ ...baseParam, ui: z.literal("switch"), default: z.boolean().optional() }),
  z.object({ ...baseParam, ui: z.literal("hidden"), default: z.json().optional() }),
  z.object({ ...baseParam, ui: z.literal("imageUpload"), default: z.array(z.string().max(4096)).optional(), maxCount: z.number().int().positive().max(64), maxSizeMB: z.number().finite().positive().max(100).optional() }),
]);
const configEnvelopeSchema = z.object({
  code: z.number().int(),
  data: z.object({
    id: z.number().int().positive(),
    modelId: z.uuid(),
    platformId: z.string().trim().min(1).max(128),
    inputType: z.string().trim().min(1).max(128),
    maxImages: z.number().int().nonnegative().max(256),
    promptPlaceholder: z.string().max(2000).optional(),
    params: z.array(mediaParamSchema).max(100),
  }),
});
const cacheLifetime = 60000;
const cache = new Map<string, { expiresAt: number; template: SuanliMediaTemplate }>();
const taskStatuses = ["queued", "processing", "completed", "failed", "cancelled", "timeout"] as const;
const taskStatusSchema = z.enum(taskStatuses);
const taskStateSchema = z.object({
  task_id: z.uuid(),
  client_task_id: z.string().max(64).nullable().optional(),
  status: taskStatusSchema,
  position: z.number().int().nonnegative().optional(),
  vendor_raw: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.unknown().nullable().optional(),
}).passthrough();
const taskStateEnvelopeSchema = z.object({ code: z.number().int(), data: taskStateSchema });
const taskSubmitEnvelopeSchema = z.object({
  code: z.number().int(),
  data: z.object({
    task_id: z.uuid(),
    client_task_id: z.string().max(64).nullable().optional(),
    status: z.enum(["queued", "processing"]),
    position: z.number().int().nonnegative().optional(),
  }),
});
const taskCancelEnvelopeSchema = z.object({
  code: z.number().int(),
  data: z.object({ task_id: z.uuid(), cancelled: z.boolean() }),
});
const taskResultSchema = z.object({ url: z.string().url().max(8192), outputType: z.string().trim().min(1).max(128) }).passthrough();
const taskPollInterval = 2000;
const taskWaitLimit = 30 * 60 * 1000;
const suanliOutputMimeTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac", m4a: "audio/mp4", opus: "audio/opus",
};

function failure(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function valueAtPath(value: unknown, path: readonly PropertyKey[]) {
  let current = value;
  for (const part of path) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<PropertyKey, unknown>)[part];
  }
  return current;
}

function valueType(value: unknown) {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

function findShowWhenCycle(params: SuanliMediaParam[]) {
  const paramsByName = new Map(params.map(param => [param.name, param]));
  const visited = new Set<string>();
  const visiting = new Map<string, number>();
  const path: string[] = [];
  function visit(name: string): string[] | undefined {
    const cycleStart = visiting.get(name);
    if (cycleStart !== undefined) return [...path.slice(cycleStart), name];
    if (visited.has(name)) return undefined;
    visiting.set(name, path.length);
    path.push(name);
    for (const dependency of Object.keys(paramsByName.get(name)?.showWhen ?? {})) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(name);
    visited.add(name);
    return undefined;
  }
  for (const name of paramsByName.keys()) {
    const cycle = visit(name);
    if (cycle) return cycle;
  }
  return undefined;
}

function recordTemplateFieldFailure(
  model: Awaited<ReturnType<typeof getSuanliModelByRef>>,
  startedAt: number,
  path: Array<string | number>,
  code: string,
  receivedType?: string,
) {
  return recordSuanliFailure({
    path: `models/${model.modelId}/config`, method: "GET", phase: "validation", reason: code, status: 502, upstreamStatus: 200, durationMs: Date.now() - startedAt,
    template: {
      modelRef: model.modelRef,
      modelId: model.modelId,
      catalogPlatformCode: model.platformCode,
      actualModelId: model.modelId,
      modelIdMatches: true,
      validationIssues: [{ path, code, ...(receivedType ? { receivedType } : {}) }],
    },
  });
}

function summarizeValidationIssues(body: unknown, issues: readonly { code: string; path: readonly PropertyKey[]; expected?: unknown }[]) {
  return issues.slice(0, 100).map(issue => {
    const path = issue.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number");
    const received = valueAtPath(body, issue.path);
    const receivedValue = path.at(-1) === "ui" && typeof received === "string" ? received.slice(0, 128) : undefined;
    return {
      path,
      code: issue.code,
      ...(typeof issue.expected === "string" ? { expected: issue.expected } : {}),
      ...(received !== undefined ? { receivedType: valueType(received) } : {}),
      ...(receivedValue !== undefined ? { receivedValue } : {}),
    };
  });
}

function copyMediaTemplate(template: SuanliMediaTemplate): SuanliMediaTemplate {
  return {
    ...template,
    params: template.params.map((param): SuanliMediaParam => {
      if (param.ui === "quantity") return { ...param, options: [...param.options] };
      if (param.ui === "proportion" || param.ui === "resolution" || param.ui === "select") return { ...param, options: [...param.options] };
      return { ...param, ...(param.showWhen ? { showWhen: { ...param.showWhen } } : {}) };
    }),
  };
}

export async function readSuanliMediaTemplate(modelRef: string) {
  const model = await getSuanliModelByRef(modelRef);
  if (!getSuanliModelMediaTypes(model).length) {
    throw failure("所选算力模型不是媒体模型", 400);
  }
  const session = getSuanliSession();
  if (!session) throw failure("请先登录 SXWZ 算力账号", 401);
  const key = [session.identity.userId, session.identity.sessionId, model.modelRef].join("\0");
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return copyMediaTemplate(cached.template);
  const startedAt = Date.now();
  const body = await requestSuanliJson<unknown>(`models/${encodeURIComponent(model.modelId)}/config`, {}, session);
  const parsed = configEnvelopeSchema.safeParse(body);
  const envelope = object(body);
  const data = object(envelope.data);
  const actualModelId = typeof data.modelId === "string" ? data.modelId : undefined;
  const actualPlatformId = typeof data.platformId === "string" ? data.platformId : undefined;
  const modelIdMatches = actualModelId === model.modelId;
  if (!parsed.success || parsed.data.code !== 0 || !modelIdMatches) {
    await recordSuanliFailure({
      path: `models/${model.modelId}/config`, method: "GET", phase: "validation", reason: "invalid_template",
      status: 502, upstreamStatus: 200, durationMs: Date.now() - startedAt,
      template: {
        modelRef: model.modelRef,
        modelId: model.modelId,
        catalogPlatformCode: model.platformCode,
        ...(actualModelId !== undefined ? { actualModelId } : {}),
        ...(actualPlatformId !== undefined ? { templatePlatformId: actualPlatformId } : {}),
        ...(typeof envelope.code === "number" ? { upstreamCode: envelope.code } : {}),
        ...(typeof data.inputType === "string" ? { inputType: data.inputType } : {}),
        modelIdMatches,
        ...(!parsed.success ? { validationIssues: summarizeValidationIssues(body, parsed.error.issues) } : {}),
      },
    });
    throw failure("算力中台返回的模型参数模板格式或归属无效", 502);
  }
  const template: SuanliMediaTemplate = {
    modelId: parsed.data.data.modelId,
    platformId: parsed.data.data.platformId,
    inputType: parsed.data.data.inputType,
    maxImages: parsed.data.data.maxImages,
    ...(parsed.data.data.promptPlaceholder ? { promptPlaceholder: parsed.data.data.promptPlaceholder } : {}),
    params: parsed.data.data.params,
    canGenerate: parsed.data.data.inputType === "text"
      || parsed.data.data.params.some(param => param.ui === "imageUpload"),
  };
  const names = new Set<string>();
  for (const param of template.params) {
    if (names.has(param.name)) {
      await recordSuanliFailure({ path: `models/${model.modelId}/config`, method: "GET", phase: "validation", reason: "duplicate_parameter", status: 502, upstreamStatus: 200, durationMs: Date.now() - startedAt });
      throw failure("算力中台返回了重复模型参数", 502);
    }
    if (["__proto__", "prototype", "constructor"].includes(param.name)) {
      await recordSuanliFailure({ path: `models/${model.modelId}/config`, method: "GET", phase: "validation", reason: "invalid_parameter_name", status: 502, upstreamStatus: 200, durationMs: Date.now() - startedAt });
      throw failure("算力中台返回了无效模型参数名", 502);
    }
    names.add(param.name);
  }
  for (const [index, param] of template.params.entries()) {
    const invalidReference = Object.keys(param.showWhen ?? {}).find(name => !names.has(name));
    if (invalidReference !== undefined) {
      await recordTemplateFieldFailure(model, startedAt, ["data", "params", index, "showWhen", invalidReference], "invalid_show_when_reference");
      throw failure("算力中台返回了引用不存在参数的条件字段", 502);
    }
    const unsupportedReference = Object.keys(param.showWhen ?? {}).find(name => {
      const dependency = template.params.find(candidate => candidate.name === name);
      return dependency?.ui === "hidden" || dependency?.ui === "imageUpload";
    });
    if (unsupportedReference !== undefined) {
      const dependency = template.params.find(candidate => candidate.name === unsupportedReference)!;
      await recordTemplateFieldFailure(model, startedAt, ["data", "params", index, "showWhen", unsupportedReference], "unsupported_show_when_reference", dependency.ui);
      throw failure("算力中台返回了依赖非编辑字段的条件参数", 502);
    }
  }
  const showWhenCycle = findShowWhenCycle(template.params);
  if (showWhenCycle) {
    const index = template.params.findIndex(param => param.name === showWhenCycle[0]);
    await recordTemplateFieldFailure(model, startedAt, ["data", "params", index, "showWhen"], "cyclic_show_when", "cycle");
    throw failure("算力中台返回了循环依赖的条件参数", 502);
  }
  cache.set(key, { expiresAt: Date.now() + cacheLifetime, template });
  return copyMediaTemplate(template);
}

function fail(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parameterVisible(param: SuanliMediaParam, candidates: Map<string, unknown>, paramsByName: Map<string, SuanliMediaParam>, ancestors = new Set<string>()): boolean {
  if (!param.showWhen) return true;
  if (ancestors.has(param.name)) return false;
  const nextAncestors = new Set(ancestors).add(param.name);
  return Object.entries(param.showWhen).every(([name, expected]) => {
    const dependency = paramsByName.get(name);
    return dependency !== undefined && dependency.ui !== "hidden" && dependency.ui !== "imageUpload"
      && parameterVisible(dependency, candidates, paramsByName, nextAncestors)
      && Object.is(candidates.get(name), expected);
  });
}

export function buildSuanliTaskBody(
  template: SuanliMediaTemplate,
  values: Record<string, unknown>,
  imageUploads: Record<string, string | string[]> = {},
  allowMissingUploads = false,
) {
  const names = new Set(template.params.map(param => param.name));
  const paramsByName = new Map(template.params.map(param => [param.name, param]));
  if (Object.keys(values).some(name => !names.has(name))) throw fail("请求包含当前模型模板之外的参数", 400);
  const uploadNames = new Set(template.params.filter(param => param.ui === "imageUpload").map(param => param.name));
  if (Object.keys(imageUploads).some(name => !uploadNames.has(name))) throw fail("服务端图片映射包含当前模型模板之外的参数", 400);
  const body: Record<string, unknown> = Object.create(null);
  const candidates = new Map(template.params.map(param => [param.name,
    param.ui === "hidden" ? param.default : Object.hasOwn(values, param.name) ? values[param.name] : param.default]));
  for (const [name, value] of Object.entries(imageUploads)) candidates.set(name, value);
  for (const param of template.params) {
    const providedByClient = Object.hasOwn(values, param.name);
    if (!parameterVisible(param, candidates, paramsByName)) {
      if (providedByClient || Object.hasOwn(imageUploads, param.name)) throw fail(`条件隐藏的模型参数 ${param.name} 不允许提交`, 400);
      continue;
    }
    if (param.ui === "imageUpload") {
      if (providedByClient) throw fail(`模型参数 ${param.name} 只能由服务端读取图片`, 400);
      const uploaded = imageUploads[param.name];
      if (uploaded === undefined) {
        if (param.required && !allowMissingUploads) throw fail(`模型参数 ${param.name} 需要参考图片`, 400);
        continue;
      }
      if (param.name === "imageUrl") {
        if (typeof uploaded !== "string" || !/^data:image\/[a-z0-9.+-]+;base64,[a-zA-Z0-9+/]+={0,2}$/.test(uploaded)) {
          throw fail(`模型参数 ${param.name} 的服务端图片数据无效`, 400);
        }
        body[param.name] = uploaded;
        continue;
      }
      if (!Array.isArray(uploaded) || uploaded.length > param.maxCount
        || uploaded.some(value => typeof value !== "string" || !/^data:image\/[a-z0-9.+-]+;base64,[a-zA-Z0-9+/]+={0,2}$/.test(value))) {
        throw fail(`模型参数 ${param.name} 的服务端图片数据无效`, 400);
      }
      if (param.required && !uploaded.length) throw fail(`模型参数 ${param.name} 需要参考图片`, 400);
      body[param.name] = uploaded;
      continue;
    }
    let provided = providedByClient ? values[param.name] : param.default;
    if (param.ui === "hidden") {
      if (providedByClient) throw fail(`模型参数 ${param.name} 不允许由客户端修改`, 400);
      if (param.required && param.default === undefined) throw fail(`缺少必填参数：${param.label}`, 400);
      if (param.default !== undefined) body[param.name] = param.default;
      continue;
    }
    if (param.ui === "number" && provided === "" && param.default !== undefined) provided = param.default;
    if (provided === undefined) {
      if (param.required) throw fail(`请填写${param.label}`, 400);
      continue;
    }
    if (param.ui === "textarea") {
      if (typeof provided !== "string" || provided.length > (param.maxLength ?? 20000) || param.required && !provided.trim()) {
        throw fail(`${param.label}无效`, 400);
      }
    } else if (param.ui === "switch") {
      if (typeof provided !== "boolean") throw fail(`${param.label}无效`, 400);
    } else if (param.ui === "number") {
      if (typeof provided !== "number" || !Number.isFinite(provided)
        || param.min !== undefined && provided < param.min
        || param.max !== undefined && provided > param.max) throw fail(`${param.label}无效`, 400);
    } else if (param.ui === "dimension") {
      const parts = typeof provided === "string" ? provided.split(param.dimension.separator) : [];
      const width = Number(parts[0]);
      const height = Number(parts[1]);
      if (parts.length !== 2 || !parts.every(part => /^\d+$/.test(part))
        || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
        || param.dimension.width?.min !== undefined && width < param.dimension.width.min
        || param.dimension.width?.max !== undefined && width > param.dimension.width.max
        || param.dimension.height?.min !== undefined && height < param.dimension.height.min
        || param.dimension.height?.max !== undefined && height > param.dimension.height.max) {
        throw fail(`${param.label}无效`, 400);
      }
    } else if (!param.options.some(option => Object.is(option, provided))) {
      throw fail(`请选择有效的${param.label}`, 400);
    }
    body[param.name] = provided;
  }
  return body;
}

async function readTask(taskId: string, session: NonNullable<ReturnType<typeof getSuanliSession>>, signal?: AbortSignal) {
  const response = await requestSuanliJson<unknown>(`tasks/${encodeURIComponent(taskId)}`, { signal }, session);
  const parsed = taskStateEnvelopeSchema.safeParse(response);
  if (!parsed.success || parsed.data.code !== 0 || parsed.data.data.task_id === undefined) throw fail("算力中台返回的任务状态格式无效", 502);
  if (parsed.data.data.task_id !== taskId && parsed.data.data.client_task_id !== taskId) throw fail("算力中台返回了不匹配的任务", 502);
  return parsed.data.data;
}

async function resolveSubmittedTask(clientTaskId: string, session: NonNullable<ReturnType<typeof getSuanliSession>>, cause: unknown) {
  try {
    const task = await readTask(clientTaskId, session, AbortSignal.timeout(10000));
    if (task.client_task_id !== clientTaskId) throw fail("算力中台返回了不匹配的 client_task_id", 502);
    return task;
  } catch (error) {
    if ((error as { upstreamStatus?: number })?.upstreamStatus === 404) throw cause;
    throw fail("任务提交结果暂时无法确认。为避免重复扣费，请稍后查询任务状态后再决定是否重试。", 409);
  }
}

async function cancelQueuedTask(taskId: string, session: NonNullable<ReturnType<typeof getSuanliSession>>) {
  try {
    const response = await requestSuanliJson<unknown>(`tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: "POST", signal: AbortSignal.timeout(5000),
    }, session);
    const parsed = taskCancelEnvelopeSchema.safeParse(response);
    if (!parsed.success || parsed.data.code !== 0 || parsed.data.data.task_id !== taskId) return;
  } catch { /* 上游状态可能已从 queued 转为 processing；不声称取消成功。 */ }
}

function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    }
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function taskErrorMessage(task: z.infer<typeof taskStateSchema>) {
  const error = object(task.error);
  const vendorRaw = object(task.vendor_raw);
  const eventData = object(vendorRaw.eventData);
  const message = [error.message, eventData.errorMessage, eventData.failedReason].find(value => typeof value === "string" && value.trim());
  return typeof message === "string" ? message.trim().slice(0, 500) : "上游没有提供失败原因";
}

function taskResults(task: z.infer<typeof taskStateSchema>, mediaType: "image" | "video" | "audio") {
  const vendorRaw = object(task.vendor_raw);
  const eventData = object(vendorRaw.eventData);
  const results = eventData.results;
  if (!Array.isArray(results) || !results.length || results.length > 64) throw fail("算力中台已完成任务，但没有返回可用的媒体结果", 502);
  return results.map(result => {
    const parsed = taskResultSchema.safeParse(result);
    if (!parsed.success) throw fail("算力中台返回的媒体结果格式无效", 502);
    let url: URL;
    try { url = new URL(parsed.data.url); }
    catch { throw fail("算力中台返回的媒体地址无效", 502); }
    if (url.protocol !== "https:" || url.username || url.password) throw fail("算力中台返回的媒体地址不安全", 502);
    const outputType = parsed.data.outputType.toLowerCase().replace(/^\./, "");
    const mimeType = suanliOutputMimeTypes[outputType] ?? Object.values(suanliOutputMimeTypes).find(value => value === outputType);
    if (!mimeType?.startsWith(`${mediaType}/`)) throw fail("算力中台返回的媒体类型与节点不匹配", 502);
    return { type: "url" as const, url: url.href, mimeType, mediaType };
  });
}

export async function generateSuanliMedia(
  mediaType: "image" | "video",
  modelRef: string,
  template: SuanliMediaTemplate,
  values: Record<string, unknown>,
  imageUploads: Record<string, string | string[]>,
  clientTaskId: string,
  expectedSession: NonNullable<ReturnType<typeof getSuanliSession>>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const model = await getSuanliModelByRef(modelRef);
  if (!getSuanliModelMediaTypes(model).includes(mediaType)) {
    throw fail("所选算力模型与当前媒体节点类型不匹配", 400);
  }
  const session = getSuanliSession();
  if (!session?.identity.sessionId) throw fail("请先登录 SXWZ 算力账号", 401);
  if (session.token !== expectedSession.token || JSON.stringify(session.identity) !== JSON.stringify(expectedSession.identity)) {
    throw fail("SXWZ 登录状态已变化，请重新读取模型目录", 409);
  }
  if (template.modelId !== model.modelId) {
    throw fail("所选算力模型与已读取参数模板不匹配", 400);
  }
  if (!template.canGenerate) throw fail("此模型当前需要上传参考素材或不支持纯文本输入", 400);
  const body = buildSuanliTaskBody(template, values, imageUploads);
  const requestBody = {
    model_id: model.modelId,
    platform_code: model.platformCode,
    client_task_id: clientTaskId,
    body,
    sessionId: session.identity.sessionId,
    ...(model.sourceType?.toLowerCase() === "school" ? { school_id: session.identity.schoolId } : {}),
  };
  const serializedRequestBody = JSON.stringify(requestBody);
  if (Buffer.byteLength(serializedRequestBody) > 100 * 1024 * 1024) throw fail("算力任务请求体超过 100 MiB", 400);
  let task: z.infer<typeof taskStateSchema> | undefined;
  let response: unknown;
  try {
    response = await requestSuanliJson<unknown>("tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serializedRequestBody,
      signal,
    }, session);
  } catch (error) {
    if ((error as { upstreamStatus?: number })?.upstreamStatus !== undefined
      && Number((error as { upstreamStatus: number }).upstreamStatus) < 500) throw error;
    task = await resolveSubmittedTask(clientTaskId, session, error);
  }
  if (response !== undefined) {
    const parsed = taskSubmitEnvelopeSchema.safeParse(response);
    if (!parsed.success) task = await resolveSubmittedTask(clientTaskId, session, fail("算力中台提交响应格式无效", 502));
    else if (parsed.data.code !== 0) throw fail("算力中台拒绝创建生成任务", 502);
    else if (parsed.data.data.client_task_id && parsed.data.data.client_task_id !== clientTaskId) {
      throw fail("算力中台返回了不匹配的 client_task_id", 502);
    } else {
      task = {
        task_id: parsed.data.data.task_id,
        client_task_id: parsed.data.data.client_task_id,
        status: parsed.data.data.status,
        position: parsed.data.data.position,
      };
    }
  }
  if (!task) throw fail("算力中台没有返回任务状态", 502);
  const deadline = Date.now() + taskWaitLimit;
  try {
    while (task.status === "queued" || task.status === "processing") {
      signal?.throwIfAborted();
      if (Date.now() >= deadline) throw fail("等待算力任务超时；上游任务可能仍在运行并计费", 504);
      await wait(Math.min(taskPollInterval, deadline - Date.now()), signal);
      task = await readTask(task.task_id, session, signal);
    }
  } catch (error) {
    if (signal?.aborted) {
      if (task.status === "queued") await cancelQueuedTask(task.task_id, session);
      throw signal.reason ?? error;
    }
    throw error;
  }
  signal?.throwIfAborted();
  if (task.status !== "completed") {
    const statusText = task.status === "failed" ? "失败" : task.status === "cancelled" ? "已取消" : "超时";
    throw fail(`SXWZ 算力任务${statusText}：${taskErrorMessage(task)}`, task.status === "timeout" ? 504 : 502);
  }
  return taskResults(task, mediaType);
}
