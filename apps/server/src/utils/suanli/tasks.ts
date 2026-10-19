import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, unlink, writeAtomic } from "@toonflow/file";
import { resolve } from "node:path";
import { z } from "zod";
import { getCurrentUser } from "@/lib/userContext";
import { requestSuanliJson } from "./client";
import { getSuanliModelWithConfig } from "./models";
import { isOwnedSuanliImageUrl } from "./oss";
import type { SuanliParam } from "./types";

const taskLifetime = 72 * 60 * 60 * 1000;
const maxTaskRecords = 500;
const taskRecordSchema = z.object({
  clientTaskId: z.uuid(),
  taskId: z.uuid().optional(),
  modelId: z.uuid(),
  createdAt: z.number().finite(),
});
const taskStatusSchema = z.enum(["queued", "processing", "completed", "failed", "cancelled", "timeout"]);
const taskVendorRawSchema = z.object({
  eventData: z.object({ results: z.unknown().optional() }).passthrough(),
}).passthrough();
const taskEnvelopeSchema = z.object({
  code: z.number().int(),
  data: z.object({
    task_id: z.uuid(),
    client_task_id: z.string().max(64).optional(),
    status: taskStatusSchema,
    position: z.number().finite().optional(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
    vendor_raw: z.unknown().optional(),
    created_at: z.string().max(128).optional(),
    updated_at: z.string().max(128).optional(),
  }).passthrough(),
});
const taskQueues = new Map<string, Promise<void>>();

function failure(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function serializeUser<T>(userId: string, operation: () => Promise<T>) {
  const previous = taskQueues.get(userId) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const tail = result.then(() => {}, () => {});
  taskQueues.set(userId, tail);
  return result.finally(() => { if (taskQueues.get(userId) === tail) taskQueues.delete(userId); });
}

function taskDirectory() {
  return resolve(getCurrentUser().dataDirectory, "suanliTasks");
}

async function ensureTaskDirectory() {
  const directory = taskDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw failure("算力任务记录目录格式无效", 500);
  await chmod(directory, 0o700);
  return directory;
}

async function readRecord(path: string) {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!info || info.isSymbolicLink() || !info.isFile()) return undefined;
  const parsed = taskRecordSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
  return parsed.success ? parsed.data : undefined;
}

async function reserveTask(record: z.infer<typeof taskRecordSchema>) {
  return serializeUser(getCurrentUser().userId, async () => {
    const directory = await ensureTaskDirectory();
    const names = await readdir(directory);
    let count = 0;
    for (const name of names) {
      if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
      const path = resolve(directory, name);
      const stored = await readRecord(path);
      if (stored && stored.createdAt + taskLifetime <= Date.now()) {
        await unlink(path);
        continue;
      }
      count++;
    }
    if (count >= maxTaskRecords) throw failure("任务记录已满，请稍后重试", 429);
    await writeAtomic(resolve(directory, `${record.clientTaskId}.json`), JSON.stringify(record), { exclusive: true, mode: 0o600 });
  });
}

async function updateTaskRecord(clientTaskId: string, taskId: string) {
  return serializeUser(getCurrentUser().userId, async () => {
    const directory = await ensureTaskDirectory();
    const path = resolve(directory, `${clientTaskId}.json`);
    const current = await readRecord(path);
    if (!current) throw failure("算力任务记录无法保存", 500);
    await writeAtomic(path, JSON.stringify({ ...current, taskId }), { mode: 0o600 });
  });
}

async function removeTaskRecord(clientTaskId: string) {
  return serializeUser(getCurrentUser().userId, async () => {
    await unlink(resolve(await ensureTaskDirectory(), `${clientTaskId}.json`)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  });
}

async function findOwnedTask(taskId: string) {
  const directory = await ensureTaskDirectory();
  for (const name of await readdir(directory)) {
    if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
    const record = await readRecord(resolve(directory, name));
    if ((record?.taskId === taskId || record?.clientTaskId === taskId) && record.createdAt + taskLifetime > Date.now()) return record;
  }
  throw failure("找不到此任务", 404);
}

function hasOwn(values: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(values, key);
}

function invalidField(field: SuanliParam, reason = "参数无效"): never {
  throw failure(`${field.label}${reason}`, 400);
}

function defaultOrSubmitted(field: SuanliParam, input: Record<string, unknown>) {
  if (field.ui === "hidden") return field.default;
  return hasOwn(input, field.name) ? input[field.name] : field.default;
}

function validateTaskBody(params: SuanliParam[], input: Record<string, unknown>, userId: string) {
  const body: Record<string, unknown> = {};
  for (const field of params) {
    const value = defaultOrSubmitted(field, input);
    if (value === undefined) {
      if (field.required) invalidField(field, "为必填项");
      continue;
    }
    if (field.ui === "hidden") {
      body[field.name] = value;
      continue;
    }
    if (field.ui === "textarea") {
      if (typeof value !== "string" || value.length > 20000 || (field.required && !value.trim())) invalidField(field);
    } else if (field.ui === "proportion" || field.ui === "resolution" || field.ui === "select" || field.ui === "quantity") {
      if (!field.options.some(option => Object.is(option, value))) invalidField(field);
    } else if (field.ui === "dimension") {
      if (typeof value !== "string") invalidField(field);
      const parts = value.split(field.dimension.separator);
      if (parts.length !== 2 || !parts.every(part => /^\d+$/.test(part))) invalidField(field);
      const [width, height] = parts.map(Number);
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
        || (field.dimension.width?.min !== undefined && width < field.dimension.width.min)
        || (field.dimension.width?.max !== undefined && width > field.dimension.width.max)
        || (field.dimension.height?.min !== undefined && height < field.dimension.height.min)
        || (field.dimension.height?.max !== undefined && height > field.dimension.height.max)) invalidField(field);
    } else if (field.ui === "imageUpload") {
      if (!Array.isArray(value) || value.length > field.maxCount || (field.required && !value.length)
        || !value.every(url => typeof url === "string" && url.length <= 4096 && isOwnedSuanliImageUrl(url, userId))) invalidField(field);
    }
    body[field.name] = value;
  }
  return body;
}

function taskData(body: unknown) {
  const parsed = taskEnvelopeSchema.safeParse(body);
  if (!parsed.success || parsed.data.code !== 0) throw failure("算力中台返回的任务数据无效", 502);
  const data = parsed.data.data;
  const vendorRaw = taskVendorRawSchema.safeParse(data.vendor_raw);
  const result = data.result ?? (vendorRaw.success ? vendorRaw.data.eventData.results : undefined);
  return { ...data, ...(result === undefined ? {} : { result }) };
}

function cleanTaskError(value: unknown) {
  if (typeof value === "string") return value.slice(0, 8192);
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") return value.message.slice(0, 8192);
}

export async function createSuanliTask(
  modelRef: string,
  input: unknown,
  onReserved: (task: { clientTaskId: string; modelLabel: string }) => Promise<void>,
  signal?: AbortSignal,
) {
  const user = getCurrentUser();
  const identity = user.suanliIdentity;
  if (!identity?.userId || !identity.sessionId) throw failure("当前登录状态缺少算力身份，请重新登录", 401);
  const inputResult = z.record(z.string(), z.unknown()).safeParse(input);
  if (!inputResult.success) throw failure("任务参数必须是对象", 400);
  const { model, params } = await getSuanliModelWithConfig(modelRef, identity);
  if (model.kind.toLowerCase() === "llm") throw failure("文本模型应通过 Agent 对话发送", 400);
  const body = validateTaskBody(params, inputResult.data, user.userId);
  const clientTaskId = randomUUID();
  const createdAt = Date.now();
  await reserveTask({ clientTaskId, modelId: model.modelId, createdAt });
  try {
    await onReserved({ clientTaskId, modelLabel: model.label });
  } catch (cause) {
    await removeTaskRecord(clientTaskId);
    throw cause;
  }
  const requestBody = {
    model_id: model.modelId,
    platform_code: model.platformCode,
    client_task_id: clientTaskId,
    body,
    sessionId: identity.sessionId,
    user_id: identity.userId,
    ...(identity.schoolId ? { school_id: identity.schoolId } : {}),
  };
  let response: unknown;
  try {
    response = await requestSuanliJson<unknown>("tasks", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody),
      signal,
    });
  } catch {
    throw Object.assign(failure("任务提交结果未确认，可使用任务编号查询状态", 502), { clientTaskId });
  }
  let task: z.infer<typeof taskEnvelopeSchema>["data"];
  try { task = taskData(response); }
  catch { throw Object.assign(failure("任务提交结果未确认，可使用任务编号查询状态", 502), { clientTaskId }); }
  if (task.client_task_id && task.client_task_id !== clientTaskId) {
    throw Object.assign(failure("任务提交结果未确认，可使用任务编号查询状态", 502), { clientTaskId });
  }
  try { await updateTaskRecord(clientTaskId, task.task_id); }
  catch { throw Object.assign(failure("任务已提交，但任务记录暂未确认，可使用任务编号查询状态", 502), { clientTaskId }); }
  const error = cleanTaskError(task.error);
  return {
    taskId: task.task_id,
    clientTaskId,
    status: task.status,
    ...(task.position === undefined ? {} : { position: task.position }),
    ...(task.result === undefined ? {} : { result: task.result }),
    ...(error === undefined ? {} : { error }),
  };
}

export async function getSuanliTask(taskId: string, signal?: AbortSignal) {
  const record = await findOwnedTask(taskId);
  const lookupId = record.taskId ?? record.clientTaskId;
  const task = taskData(await requestSuanliJson<unknown>(`tasks/${encodeURIComponent(lookupId)}`, { signal }));
  if ((record.taskId && task.task_id !== record.taskId) || (task.client_task_id && task.client_task_id !== record.clientTaskId)) throw failure("算力中台返回的任务标识不匹配", 502);
  if (!record.taskId) await updateTaskRecord(record.clientTaskId, task.task_id);
  return {
    taskId: task.task_id,
    clientTaskId: record.clientTaskId,
    status: task.status,
    ...(task.position === undefined ? {} : { position: task.position }),
    ...(task.result === undefined ? {} : { result: task.result }),
    ...(cleanTaskError(task.error) === undefined ? {} : { error: cleanTaskError(task.error) }),
    ...(task.created_at ? { createdAt: task.created_at } : {}),
    ...(task.updated_at ? { updatedAt: task.updated_at } : {}),
  };
}

export async function cancelSuanliTask(taskId: string, signal?: AbortSignal) {
  let record = await findOwnedTask(taskId);
  const current = taskData(await requestSuanliJson<unknown>(`tasks/${encodeURIComponent(record.taskId ?? record.clientTaskId)}`, { signal }));
  if ((record.taskId && current.task_id !== record.taskId) || (current.client_task_id && current.client_task_id !== record.clientTaskId)) {
    throw failure("算力中台返回的任务标识不匹配", 502);
  }
  if (current.status !== "queued") throw failure("只有排队中的任务可以取消", 409);
  if (!record.taskId) {
    await updateTaskRecord(record.clientTaskId, current.task_id);
    record = { ...record, taskId: current.task_id };
  }
  const upstreamTaskId = record.taskId;
  if (!upstreamTaskId) throw failure("算力任务标识无效", 500);
  const body = await requestSuanliJson<unknown>(`tasks/${encodeURIComponent(upstreamTaskId)}/cancel`, { method: "POST", signal });
  const parsed = z.object({ code: z.number().int() }).passthrough().safeParse(body);
  if (!parsed.success || parsed.data.code !== 0) throw failure("算力中台返回的任务数据无效", 502);
  return { taskId: upstreamTaskId, clientTaskId: record.clientTaskId, status: "cancelled" as const };
}
