import { chmod, constants, lstat, mkdir, open, stat, writeAtomic } from "@toonflow/file";
import { join } from "node:path";
import { getUserDataDirectory } from "@/lib/userContext";

const maxLogBytes = 1024 * 1024;
const retainedLogBytes = 512 * 1024;
const safePlatforms = new Set(["ai_chat", "ai_coding", "ai_painting_talk", "ai_video_talk", "ai_music_talk"]);
let writeQueue = Promise.resolve();

export type SuanliFailureLog = {
  path: string;
  method: string;
  phase: "request" | "response" | "body" | "validation";
  reason: string;
  status: number;
  upstreamStatus?: number;
  durationMs: number;
  errorName?: string;
  template?: {
    modelRef: string;
    modelId: string;
    expectedPlatformId: string;
    actualModelId?: string;
    actualPlatformId?: string;
    upstreamCode?: number;
    inputType?: string;
    modelIdMatches: boolean;
    platformIdMatches: boolean;
    validationIssues?: Array<{
      path: Array<string | number>;
      code: string;
      expected?: string;
      receivedType?: string;
      receivedValue?: string;
    }>;
  };
};

function safePath(value: string) {
  const path = value.split(/[?#]/, 1)[0]!.replace(/^\/+/, "").replace(/\/+$/, "");
  if (path === "platforms/list") return path;
  const platformModels = path.match(/^platforms\/([^/]+)\/models$/);
  if (platformModels && safePlatforms.has(platformModels[1]!)) return `platforms/${platformModels[1]}/models`;
  const modelConfig = path.match(/^models\/([a-f\d-]{36})\/config$/i);
  if (modelConfig) return `models/${modelConfig[1]}/config`;
  if (/^models\/[^/]+\/config$/.test(path)) return "models/:modelId/config";
  if (path === "tasks") return path;
  if (/^tasks\/[^/]+(?:\/cancel)?$/.test(path)) return path.endsWith("/cancel") ? "tasks/:taskId/cancel" : "tasks/:taskId";
  return "other";
}

function safeMethod(value: string) {
  const method = value.toUpperCase();
  return ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) ? method : "OTHER";
}

function safeErrorName(value?: string) {
  return value === "TimeoutError" || value === "AbortError" || value === "TypeError" ? value : value ? "Error" : undefined;
}

function safeTemplateDetails(value?: SuanliFailureLog["template"]) {
  if (!value) return undefined;
  return {
    modelRef: value.modelRef.slice(0, 256),
    modelId: value.modelId.slice(0, 128),
    expectedPlatformId: value.expectedPlatformId.slice(0, 128),
    ...(value.actualModelId !== undefined ? { actualModelId: value.actualModelId.slice(0, 128) } : {}),
    ...(value.actualPlatformId !== undefined ? { actualPlatformId: value.actualPlatformId.slice(0, 128) } : {}),
    ...(value.upstreamCode !== undefined ? { upstreamCode: value.upstreamCode } : {}),
    ...(value.inputType !== undefined ? { inputType: value.inputType.slice(0, 128) } : {}),
    modelIdMatches: value.modelIdMatches,
    platformIdMatches: value.platformIdMatches,
    ...(value.validationIssues?.length ? {
      validationIssues: value.validationIssues.slice(0, 100).map(issue => ({
        path: issue.path.slice(0, 24).map(part => typeof part === "number" ? part : part.slice(0, 128)),
        code: issue.code.slice(0, 48).replace(/[^a-z0-9_]/gi, "_"),
        ...(issue.expected ? { expected: issue.expected.slice(0, 128) } : {}),
        ...(issue.receivedType ? { receivedType: issue.receivedType.slice(0, 32) } : {}),
        ...(issue.receivedValue !== undefined ? { receivedValue: issue.receivedValue.slice(0, 128) } : {}),
      })),
    } : {}),
  };
}

function logPath() {
  return join(getUserDataDirectory(), "logs", "suanliRequests.jsonl");
}

async function assertDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("算力日志目录无效");
  await chmod(path, 0o700);
}

async function assertLogFile(path: string) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("算力日志文件无效");
    await chmod(path, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function rotateLog(path: string) {
  const info = await stat(path);
  if (info.size <= maxLogBytes) return;
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  const file = await open(path, flags);
  let tail: Buffer;
  try {
    const size = (await file.stat()).size;
    tail = Buffer.alloc(Math.min(size, retainedLogBytes));
    await file.read(tail, 0, tail.length, Math.max(0, size - tail.length));
  } finally {
    await file.close();
  }
  const firstLineEnd = tail.indexOf(0x0a);
  const retained = firstLineEnd < 0 ? Buffer.alloc(0) : tail.subarray(firstLineEnd + 1);
  await writeAtomic(path, retained, { mode: 0o600 });
}

async function appendLog(path: string, line: string) {
  const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0);
  const file = await open(path, flags, 0o600);
  try {
    await file.writeFile(line);
  } finally {
    await file.close();
  }
  await chmod(path, 0o600);
  await rotateLog(path);
}

export function recordSuanliFailure(event: SuanliFailureLog) {
  const result = writeQueue.then(async () => {
    try {
      const path = logPath();
      await assertDirectory(join(getUserDataDirectory(), "logs"));
      await assertLogFile(path);
      const template = safeTemplateDetails(event.template);
      const entry = {
        timestamp: new Date().toISOString(),
        service: "suanli",
        method: safeMethod(event.method),
        path: safePath(event.path),
        phase: event.phase,
        reason: event.reason.slice(0, 48).replace(/[^a-z0-9_]/gi, "_"),
        status: Number.isInteger(event.status) && event.status >= 100 && event.status <= 599 ? event.status : 500,
        ...(Number.isInteger(event.upstreamStatus) && event.upstreamStatus! >= 100 && event.upstreamStatus! <= 599
          ? { upstreamStatus: event.upstreamStatus } : {}),
        durationMs: Math.min(86_400_000, Math.max(0, Math.floor(event.durationMs))),
        ...(safeErrorName(event.errorName) ? { errorName: safeErrorName(event.errorName) } : {}),
        ...(template ? { template } : {}),
      };
      await appendLog(path, `${JSON.stringify(entry)}\n`);
    } catch {
      console.warn("算力中台故障日志写入失败");
    }
  });
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}
