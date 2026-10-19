import { getCurrentUser } from "@/lib/userContext";
import { saveMediaAssets } from "@/utils/media/generation";
import { getSuanliModelByRef } from "./models";
import { cancelSuanliTask, createSuanliTask, getSuanliTask } from "./tasks";

const mediaTypeByPlatform: Record<string, "image" | "video" | "audio"> = {
  ai_painting_talk: "image",
  ai_video_talk: "video",
  ai_music_talk: "audio",
};

function wait(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(), milliseconds);
    const cancel = () => {
      finish(signal.reason);
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

function resultAssets(result: unknown, mediaType: "image" | "video" | "audio"): MediaAsset[] {
  const assets: MediaAsset[] = [];
  const visited = new Set<string>();
  function visit(value: unknown, mimeType?: string, depth = 0) {
    if (depth > 10 || assets.length >= 100 || value === null || value === undefined) return;
    if (typeof value === "string") {
      const text = value.trim();
      if (text.startsWith("data:")) {
        const match = /^data:([^;,]+);base64,/.exec(text);
        if (match?.[1]?.startsWith(`${mediaType}/`) && !visited.has(text)) {
          visited.add(text);
          assets.push({ mediaType, type: "base64", data: text, mimeType: match[1] });
        }
      } else if (URL.canParse(text)) {
        const url = new URL(text);
        if ((url.protocol === "https:" || url.protocol === "http:") && !visited.has(url.href)) {
          visited.add(url.href);
          assets.push({ mediaType, type: "url", url: url.href, ...(mimeType ? { mimeType } : {}) });
        }
      } else if (/^[\[{]/.test(text)) {
        try { visit(JSON.parse(text), mimeType, depth + 1); } catch { /* A plain task message is not a media result. */ }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, mimeType, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const nextMimeType = typeof record.mimeType === "string" ? record.mimeType : typeof record.mime_type === "string" ? record.mime_type : mimeType;
    for (const item of Object.values(record)) visit(item, nextMimeType, depth + 1);
  }
  visit(result);
  return assets;
}

async function cancelQueuedTask(taskId: string | undefined) {
  if (!taskId) return;
  await cancelSuanliTask(taskId, AbortSignal.timeout(5000)).catch(() => {});
}

export async function generateSuanliNodeMedia(
  directory: string,
  outputDirectory: string,
  mediaType: "image" | "video" | "audio",
  modelRef: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const model = await getSuanliModelByRef(modelRef, getCurrentUser().suanliIdentity);
  if (mediaTypeByPlatform[model.platformCode] !== mediaType) throw Object.assign(new Error("所选算力模型与节点类型不匹配"), { status: 400 });

  const generationSignal = AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]);
  type SuanliNodeTask = Omit<Awaited<ReturnType<typeof createSuanliTask>>, "clientTaskId"> & { clientTaskId: string };
  let task: SuanliNodeTask | undefined;
  try {
    try {
      task = await createSuanliTask(modelRef, body, async () => {}, generationSignal);
    } catch (error) {
      const clientTaskId = (error as { clientTaskId?: unknown }).clientTaskId;
      if (typeof clientTaskId !== "string") throw error;
      task = await getSuanliTask(clientTaskId, generationSignal);
    }

    if (!task) throw new Error("算力中台未返回任务状态");
    let taskRef = task.taskId ?? task.clientTaskId;
    if (!taskRef) throw new Error("算力中台未返回任务标识");
    while (task.status === "queued" || task.status === "processing") {
      await wait(2000, generationSignal);
      task = await getSuanliTask(taskRef, generationSignal);
      taskRef = task.taskId ?? task.clientTaskId ?? taskRef;
    }
    generationSignal.throwIfAborted();
    if (task.status !== "completed") throw new Error(task.error || `算力任务${task.status === "cancelled" ? "已取消" : "失败"}`);
    const assets = resultAssets(task.result, mediaType);
    if (!assets.length) throw new Error("算力任务已完成，但未返回可用的媒体文件");
    return await saveMediaAssets(directory, outputDirectory, mediaType, assets, generationSignal);
  } catch (error) {
    if (generationSignal.aborted) await cancelQueuedTask(task?.taskId ?? task?.clientTaskId);
    if (signal.aborted) throw signal.reason;
    if (generationSignal.aborted) throw Object.assign(new Error("等待算力任务结果超时"), { status: 504 });
    throw error;
  }
}
