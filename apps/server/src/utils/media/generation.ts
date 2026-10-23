import { t, translateMessage } from "@/lib/i18n";
import { constants, mkdir, open, readFile, realpath, stat, unlink } from "@toonflow/file";
import { join, relative } from "node:path";
import { mediaProviders, type Provider } from "@toonflow/providers";
import type { GeneratedMedia, MediaGenerationRequest, MediaModel, MediaReference, SuanliMediaParam, SuanliMediaTemplate } from "@toonflow/tools-scaffold/runtime";
import getConfig from "@/utils/conf";
import { getMediaProvider, listMediaProviders, loadMediaProviderSource } from "@/utils/media/provider";
import { lockWorkspaceFiles, resolveWorkspacePath, writeWorkspaceFile } from "@/utils/workspace/files";
import { beginGeneration, getProviderPrice } from "@/utils/media/billing";
import { detectMimeType, readPriceReference } from "@/utils/media/priceReference";
import { getSuanliSession } from "@/utils/suanli/auth";
import { buildSuanliTaskBody, generateSuanliMedia, readSuanliMediaTemplate } from "@/utils/suanli/media";
import { getSuanliModelByRef, getSuanliModelMediaTypes, listSuanliModels, suanliMediaCapabilityTags } from "@/utils/suanli/models";

const maxMediaSize = 100 * 1024 * 1024;
const mediaExtensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "image/avif": "avif", "image/bmp": "bmp", "image/tiff": "tiff",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogv",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm",
  "audio/flac": "flac", "audio/aac": "aac", "audio/mp4": "m4a", "audio/opus": "opus", "audio/pcm": "pcm",
};
function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function imageOptions(value: unknown, pattern: RegExp) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length <= 64 && item === item.trim() && pattern.test(item)))] : undefined;
}

export async function listMediaModels(): Promise<MediaModel[]> {
  const installedProviders = await listMediaProviders();
  const localModels = installedProviders.flatMap(provider => provider.models.flatMap(model => {
    if (model.type !== "image" && model.type !== "video" && model.type !== "audio") return [];
    const builtIn = (mediaProviders as readonly Provider[]).find(item => item.id === provider.id)?.models.find(item => item.id === model.id);
    return [{
      providerId: provider.id, providerLabel: provider.label, modelId: model.id, label: model.label, type: model.type,
      supportsPrice: "supportsPrice" in provider && provider.supportsPrice === true,
      mode: model.mode, durationResolutionMap: model.durationResolutionMap, audio: model.audio,
      ...(model.type === "audio" ? { voices: model.voices } : {}),
      ...(model.type === "image" ? {
        imageSizes: imageOptions(Array.isArray(model.imageSizes) ? model.imageSizes : builtIn?.imageSizes, /^[^\u0000-\u001f\u007f]+$/),
        imageRatios: imageOptions(Array.isArray(model.imageRatios) ? model.imageRatios : builtIn?.imageRatios, /^[1-9]\d{0,3}:[1-9]\d{0,3}$/),
      } : {}),
    } as MediaModel];
  }));
  if (!getSuanliSession()) return localModels;
  const suanliModels = (await listSuanliModels()).flatMap(model => {
    return getSuanliModelMediaTypes(model).map(type => {
      const mode = type === "video" ? [
        ...(model.tags?.includes(suanliMediaCapabilityTags.textToVideo) ? ["text"] : []),
        ...(model.tags?.includes(suanliMediaCapabilityTags.imageToVideo) ? ["singleImage"] : []),
        ...(model.tags?.includes(suanliMediaCapabilityTags.firstLastFrame) ? ["startEndRequired"] : []),
      ] : undefined;
      return { providerId: "suanli", providerLabel: "SXWZ算力", modelId: model.modelRef, label: model.label, type,
        ...(model.tags ? { tags: [...model.tags] } : {}), ...(mode?.length ? { mode } : {}) } satisfies MediaModel;
    });
  });
  return [...localModels, ...suanliModels];
}

function normalizeImageMimeType(value: string) {
  const mimeType = value.split(";", 1)[0]!.trim().toLowerCase();
  return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
}

function detectImageMimeType(bytes: Uint8Array) {
  const fallback = detectMimeType(bytes, "");
  if (fallback.startsWith("image/")) return fallback;
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 16));
  if (header[0] === 0x42 && header[1] === 0x4d) return "image/bmp";
  if (header.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00]))
    || header.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) return "image/tiff";
  return undefined;
}

async function readBoundedImage(path: string, maxBytes: number, signal?: AbortSignal) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "ELOOP") invalid("参考图片不存在或不可读取");
    throw error;
  });
  try {
    const before = await file.stat();
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 1 || before.size > maxBytes) {
      invalid("参考图片为空或超过允许大小");
    }
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await file.stat();
    if (offset > maxBytes || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      invalid("参考图片在读取期间发生变化或超过允许大小");
    }
    return bytes.subarray(0, offset);
  } finally {
    await file.close();
  }
}

export async function readReference(
  cwd: string,
  reference: MediaReference,
  mediaType: string,
  signal?: AbortSignal,
  maxBytes = maxMediaSize,
  strictImageSignature = false,
): Promise<Extract<MediaInput, { type: "base64" }>> {
  signal?.throwIfAborted();
  const { path } = await resolveWorkspacePath(cwd, reference.path);
  const sizeLimit = Math.min(maxMediaSize, maxBytes);
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") invalid("参考媒体不存在");
    throw error;
  });
  if (!info.isFile() || !info.size || info.size > sizeLimit) invalid("参考媒体为空或超过允许大小");
  const bytes = strictImageSignature ? await readBoundedImage(path, sizeLimit, signal) : await readFile(path, { signal });
  if (!bytes.length || bytes.length > sizeLimit) invalid("参考媒体为空或超过允许大小");
  const mimeType = strictImageSignature ? detectImageMimeType(bytes) : detectMimeType(bytes, reference.mimeType);
  if (!mimeType) invalid("参考图片文件签名无效或不受支持");
  if (strictImageSignature && normalizeImageMimeType(reference.mimeType) !== mimeType) invalid("参考图片内容与声明类型不匹配");
  if (!mimeType.startsWith(`${mediaType}/`)) invalid(t`参考媒体类型须为 ${mediaType}`);
  return { type: "base64", data: bytes.toString("base64"), mimeType, name: reference.path };
}

const maxSuanliTaskBodyBytes = 100 * 1024 * 1024;

function suanliImageReferences(mediaType: "image" | "video", request: MediaGenerationRequest) {
  if (mediaType === "image") {
    if (request.videos?.length || request.audios?.length || request.firstFrame || request.lastFrame) invalid("图片模型只接受图片引用");
    return request.images ?? [];
  }
  if (request.videos?.length || request.audios?.length) invalid("视频模型当前不支持视频或音频引用");
  if (request.images?.length && (request.firstFrame || request.lastFrame)) invalid("视频图片引用与首尾帧不能同时提交");
  if (request.images?.length) return request.images;
  return [request.firstFrame, request.lastFrame].filter((item): item is MediaReference => item !== undefined);
}

async function prepareSuanliImageUploads(
  directory: string,
  mediaType: "image" | "video",
  request: MediaGenerationRequest,
  modelRef: string,
  template: SuanliMediaTemplate,
  baseRequestBody: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const uploadParams = template.params.filter((param): param is Extract<SuanliMediaParam, { ui: "imageUpload" }> => param.ui === "imageUpload");
  const references = suanliImageReferences(mediaType, request);
  if (!uploadParams.length) {
    if (references.length) invalid("当前算力模型参数模板不支持图片引用");
    return {};
  }
  if (uploadParams.length !== 1) invalid("当前算力模型包含无法安全映射的多个图片上传字段");
  const param = uploadParams[0]!;
  if (!modelRef.endsWith(`:${template.modelId}`)) invalid("当前算力模型参数模板与图片引用不匹配");
  const emptyBody = buildSuanliTaskBody(template, request.suanliValues?.values ?? {}, {}, true);
  const isVisible = !param.showWhen || Object.entries(param.showWhen).every(([name, expected]) => Object.hasOwn(emptyBody, name) && Object.is(emptyBody[name], expected));
  if (!isVisible) {
    if (references.length) invalid(`条件隐藏的图片参数 ${param.name} 不接受参考图片`);
    return {};
  }
  if (!references.length) {
    if (param.required) invalid(`模型参数 ${param.name} 需要至少一张参考图片`);
    return {};
  }
  if (references.length > param.maxCount || references.length > template.maxImages) {
    invalid(`模型参数 ${param.name} 的图片数量超出限制`);
  }

  const sizeLimit = Math.min(maxMediaSize, param.maxSizeMB === undefined ? maxMediaSize : Math.floor(param.maxSizeMB * 1024 * 1024));
  const files: Array<{ reference: MediaReference; size: number; maxBytes: number }> = [];
  for (const reference of references) {
    signal?.throwIfAborted();
    if (!reference || typeof reference.path !== "string" || !reference.path.trim() || typeof reference.mimeType !== "string") {
      invalid(`模型参数 ${param.name} 包含无效的图片引用`);
    }
    const { path } = await resolveWorkspacePath(directory, reference.path);
    const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") invalid(`模型参数 ${param.name} 引用的图片不存在`);
      throw error;
    });
    if (!info.isFile() || !info.size || info.size > sizeLimit) invalid(`模型参数 ${param.name} 的图片为空或超过允许大小`);
    files.push({ reference, size: info.size, maxBytes: sizeLimit });
  }

  const baseEnvelope = { ...baseRequestBody, body: emptyBody };
  const emptyFieldBytes = Buffer.byteLength(JSON.stringify({ [param.name]: references.map(() => "") }));
  const contentBytes = files.reduce((total, file) => total + Buffer.byteLength("data:image/tiff;base64,") + 4 * Math.ceil(file.size / 3), 0);
  const fieldBytes = emptyFieldBytes + contentBytes + (Object.keys(emptyBody).length ? 1 : 0);
  const baseBytes = Buffer.byteLength(JSON.stringify(baseEnvelope));
  if (baseBytes + fieldBytes - 2 > maxSuanliTaskBodyBytes) invalid(`算力任务图片参数 ${param.name} 的请求体将超过 100 MiB`);

  const imageUrls: string[] = [];
  for (const file of files) {
    signal?.throwIfAborted();
    const image = await readReference(directory, file.reference, "image", signal, file.maxBytes, true);
    imageUrls.push(`data:${image.mimeType};base64,${image.data}`);
  }
  if (param.name === "imageUrl") {
    if (imageUrls.length !== 1) invalid(`模型参数 ${param.name} 只接受一张图片`);
    return { [param.name]: imageUrls[0]! };
  }
  return { [param.name]: imageUrls };
}

async function downloadAsset(url: string, signal?: AbortSignal, redirect: "follow" | "error" = "follow") {
  if (!/^https?:\/\//i.test(url)) invalid("生成结果必须使用 HTTP 或 HTTPS 地址");
  const response = await fetch(url, { signal, redirect });
  if (!response.ok) throw new Error(t`下载生成结果失败（HTTP ${response.status}）`);
  if (Number(response.headers.get("content-length")) > maxMediaSize) {
    await response.body?.cancel();
    invalid("生成文件不能超过 100 MB");
  }
  const reader = response.body?.getReader();
  if (!reader) invalid("生成结果为空");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxMediaSize) invalid("生成文件不能超过 100 MB");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return { bytes: Buffer.concat(chunks, size), mimeType: response.headers.get("content-type") ?? "" };
}

async function assetBytes(asset: MediaAsset, mediaType: "image" | "video" | "audio", signal?: AbortSignal, rejectRedirects = false) {
  if (!asset || asset.mediaType !== mediaType) invalid("供应商返回的媒体类型不正确");
  let bytes: Uint8Array;
  let mimeType = asset.mimeType ?? "";
  if (asset.type === "url") {
    const result = await downloadAsset(asset.url, signal, rejectRedirects ? "error" : "follow");
    bytes = result.bytes;
    const responseMimeType = result.mimeType.split(";")[0].trim().toLowerCase();
    mimeType = responseMimeType && responseMimeType !== "application/octet-stream" ? result.mimeType : mimeType;
  } else if (asset.type === "base64") {
    const data = /^data:([^;,]+);base64,([\s\S]+)$/.exec(asset.data);
    const content = (data?.[2] ?? asset.data).replace(/\s/g, "");
    if (content.length > Math.ceil(maxMediaSize / 3) * 4 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(content) || content.length % 4 === 1) invalid("生成结果的 base64 内容无效或超过 100 MB");
    bytes = Buffer.from(content, "base64");
    mimeType = data?.[1] ?? mimeType;
  } else if (asset.type === "binary" && ArrayBuffer.isView(asset.data) && asset.data.BYTES_PER_ELEMENT === 1) {
    bytes = asset.data;
  } else { return invalid("供应商返回了无效的媒体结果"); }
  if (!bytes.byteLength || bytes.byteLength > maxMediaSize) invalid("生成文件为空或超过 100 MB");
  mimeType = detectMimeType(bytes, mimeType);
  if (!mimeType.startsWith(`${mediaType}/`) || !mediaExtensions[mimeType]) invalid("生成结果不是支持的图片、视频或音频格式");
  return { bytes, mimeType };
}

async function prepareRequest<T>(directory: string | undefined, mediaType: "image" | "video" | "audio", request: MediaGenerationRequest,
  read: (cwd: string, reference: MediaReference, type: string, signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) {
  const references = async (items: MediaReference[] | undefined, type: string) => {
    if (!items?.length) return items ? [] : undefined;
    if (!directory) invalid("参考媒体需要工作目录");
    // ACT: 单次请求顺序处理引用，避免数十个参考媒体同时启动探测进程。
    const result: T[] = [];
    for (const item of items) result.push(await read(directory, item, type, signal));
    return result;
  };
  const images = await references(request.images, "image");
  if (mediaType === "audio") return {
    type: "audio" as const, model: request.modelId, text: request.prompt, images, audios: await references(request.audios, "audio"),
    voice: request.voice, speed: request.speed, volume: request.volume, pitch: request.pitch, language: request.language, format: request.format, sampleRate: request.sampleRate,
  };
  if (mediaType === "image") return { type: "image" as const, model: request.modelId, prompt: request.prompt, images, ratio: request.ratio, size: request.size };
  return {
    type: "video" as const, model: request.modelId, prompt: request.prompt, images,
    videos: await references(request.videos, "video"), audios: await references(request.audios, "audio"),
    firstFrame: (await references(request.firstFrame ? [request.firstFrame] : undefined, "image"))?.[0],
    lastFrame: (await references(request.lastFrame ? [request.lastFrame] : undefined, "image"))?.[0],
    ratio: request.ratio, resolution: request.resolution, duration: request.duration, generateAudio: request.generateAudio, mode: request.mode,
  };
}

async function configuredProvider(request: MediaGenerationRequest, mediaType: "image" | "video" | "audio", signal?: AbortSignal, directory?: string) {
  const info = await getMediaProvider(request.providerId);
  if (!info.models.some(model => model.id === request.modelId && model.type === mediaType)) invalid("所选媒体模型不存在或类型不匹配，请重新选择");
  const configurations = record(getConfig().get("settings", {}).mediaProviderConfigs);
  return loadMediaProviderSource(info.source, record(configurations[info.id]), signal, undefined, directory);
}

async function preparePriceRequest(directory: string | undefined, mediaType: "image" | "video" | "audio", request: MediaGenerationRequest, signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(5000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try { return await prepareRequest(directory, mediaType, request, readPriceReference, combined); }
  catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted) throw new Error("读取参考媒体信息超时，请稍后重试");
    throw error;
  }
}

export async function getMediaPrice(directory: string | undefined, mediaType: "image" | "video" | "audio", request: MediaGenerationRequest, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const provider = await configuredProvider(request, mediaType, signal, directory);
  if (!provider.getPrice) return null;
  const prepared = await preparePriceRequest(directory, mediaType, request, signal);
  signal?.throwIfAborted();
  return getProviderPrice(provider, prepared);
}

export async function generateMedia(
  cwd: string,
  mediaType: "image" | "video" | "audio",
  request: MediaGenerationRequest,
  signal?: AbortSignal,
): Promise<GeneratedMedia[]> {
  signal?.throwIfAborted();
  if (!request.prompt.trim()) invalid("请输入生成提示词");
  const directory = await realpath(cwd);
  const outputDirectory = request.outputDirectory ?? "assets/generated";
  await resolveWorkspacePath(directory, outputDirectory, true);
  const written: string[] = [];
  const result: GeneratedMedia[] = [];
  let finish = () => {};
  try {
    let assets: MediaAsset[];
    if (request.providerId === "suanli") {
      const suanliValues = request.suanliValues;
      if (!suanliValues || suanliValues.modelRef !== request.modelId) invalid("请重新读取当前算力模型参数后再生成");
      if (mediaType === "audio") invalid("当前 SXWZ 模型目录没有音频能力标签");
      const model = await getSuanliModelByRef(suanliValues.modelRef);
      const session = getSuanliSession();
      if (!session?.identity.sessionId) invalid("请先登录 SXWZ 算力账号");
      const template = await readSuanliMediaTemplate(suanliValues.modelRef);
      const currentSession = getSuanliSession();
      if (!currentSession || currentSession.token !== session.token || JSON.stringify(currentSession.identity) !== JSON.stringify(session.identity)) {
        invalid("SXWZ 登录状态已变化，请重新读取模型目录");
      }
      const clientTaskId = crypto.randomUUID();
      const baseRequestBody: Record<string, unknown> = {
        model_id: model.modelId,
        platform_code: model.platformCode,
        client_task_id: clientTaskId,
        sessionId: session.identity.sessionId,
        ...(model.sourceType?.toLowerCase() === "school" ? { school_id: session.identity.schoolId } : {}),
      };
      const imageUploads = await prepareSuanliImageUploads(directory, mediaType, request, suanliValues.modelRef, template, baseRequestBody, signal);
      assets = await generateSuanliMedia(mediaType, suanliValues.modelRef, template, suanliValues.values, imageUploads, clientTaskId, session, signal);
    } else {
      if (request.suanliValues) invalid("本地媒体供应商不能使用 SXWZ 模型参数");
      const provider = await configuredProvider(request, mediaType, signal, directory);
      const generate = mediaType === "image" ? provider.generateImage : mediaType === "video" ? provider.generateVideo : provider.generateAudio;
      if (typeof generate !== "function") invalid(t`此供应商不支持${translateMessage({ image: "图片", video: "视频", audio: "音频" }[mediaType])}生成`);
      const rules = Array.isArray(provider.rules) ? provider.rules : [];
      if (rules.some(rule => rule.field === "apiKey") && (typeof provider.config.apiKey !== "string" || !provider.config.apiKey.trim())) invalid("请先在媒体模型设置中配置供应商 API Key");
      const prepared = await prepareRequest(directory, mediaType, request, readReference, signal);
      signal?.throwIfAborted();
      finish = beginGeneration(provider);
      const { type, ...parameters } = prepared;
      assets = type === "audio" ? await provider.generateAudio!(parameters as AudioRequest)
        : type === "image" ? await provider.generateImage!(parameters as ImageRequest) : await provider.generateVideo!(parameters as VideoRequest);
    }
    if (!Array.isArray(assets) || !assets.length) invalid("供应商未返回生成结果");
    for (const asset of assets) {
      signal?.throwIfAborted();
      const { bytes, mimeType } = await assetBytes(asset, mediaType, signal, request.providerId === "suanli");
      signal?.throwIfAborted();
      const output = await resolveWorkspacePath(directory, outputDirectory, true);
      const release = lockWorkspaceFiles([output.path]);
      try {
        await mkdir(output.path, { recursive: true });
        const file = join(outputDirectory, `${mediaType}${crypto.randomUUID()}.${mediaExtensions[mimeType]}`);
        const { path } = await resolveWorkspacePath(directory, file);
        signal?.throwIfAborted();
        await writeWorkspaceFile(path, bytes, true);
        written.push(path);
        result.push({ path: relative(directory, path).replace(/\\/g, "/"), mimeType, mediaType });
      } finally { release(); }
    }
    signal?.throwIfAborted();
    return result;
  } catch (err) {
    // ACT: 只回滚本次创建的文件，保留目录中已有的节点资源。
    await Promise.all(written.map(path => unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; })));
    throw err;
  } finally { finish(); }
}
