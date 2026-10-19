import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

const maxImageBytes = 20 * 1024 * 1024;
let client: { key: string; instance: S3Client } | undefined;

function failure(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function requiredSetting(name: string) {
  const value = process.env[name]?.trim();
  if (!value || value.length > 8192) throw failure(`请配置有效的 ${name}`, 500);
  return value;
}

function configuredUrl(value: string, name: string, allowPath: boolean) {
  if (!URL.canParse(value)) throw failure(`请检查 ${name} 配置`, 500);
  const url = new URL(value);
  const allowHttp = process.env.NODE_ENV === "dev";
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:"))) {
    throw failure(`${name} 必须使用 HTTPS 且不能包含账号、查询参数或锚点`, 500);
  }
  if (!allowPath && url.pathname !== "/") throw failure(`${name} 不能包含路径`, 500);
  return url;
}

function publicBaseUrl() {
  return configuredUrl(requiredSetting("OSS_PUBLIC_URL"), "OSS_PUBLIC_URL", true);
}

function readClientConfig() {
  const endpoint = configuredUrl(requiredSetting("OSS_ENDPOINT"), "OSS_ENDPOINT", false);
  const region = requiredSetting("OSS_REGION");
  const bucket = requiredSetting("OSS_BUCKET");
  const accessKeyId = requiredSetting("OSS_ACCESS_KEY_ID");
  const secretAccessKey = requiredSetting("OSS_ACCESS_KEY_SECRET");
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(bucket)) throw failure("OSS_BUCKET 格式无效", 500);
  return { endpoint: endpoint.origin, region, bucket, accessKeyId, secretAccessKey };
}

export function isSuanliOssConfigured() {
  try {
    readClientConfig();
    publicBaseUrl();
    return true;
  } catch { return false; }
}

function getClient(config: ReturnType<typeof readClientConfig>) {
  const key = JSON.stringify([config.endpoint, config.region, config.accessKeyId, config.secretAccessKey]);
  if (client?.key !== key) {
    client?.instance.destroy();
    client = { key, instance: new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }) };
  }
  return client.instance;
}

function detectImage(content: Uint8Array, contentType: string) {
  const signatures: { contentType: string; extension: string; matches: (bytes: Uint8Array) => boolean }[] = [
    { contentType: "image/png", extension: "png", matches: bytes => bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a },
    { contentType: "image/jpeg", extension: "jpg", matches: bytes => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
    { contentType: "image/webp", extension: "webp", matches: bytes => bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP" },
    { contentType: "image/gif", extension: "gif", matches: bytes => bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.subarray(0, 6))) },
  ];
  const detected = signatures.find(signature => signature.matches(content));
  if (!detected || contentType.split(";", 1)[0]?.trim().toLowerCase() !== detected.contentType) {
    throw failure("仅支持 PNG、JPEG、WebP 或 GIF 图片", 400);
  }
  return detected;
}

function objectPublicUrl(key: string) {
  const base = publicBaseUrl();
  const path = `${base.pathname.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
  return new URL(path, base.origin).toString();
}

export async function uploadSuanliImage(userId: string, content: Uint8Array, contentType: string) {
  if (!content.byteLength) throw failure("图片不能为空", 400);
  if (content.byteLength > maxImageBytes) throw failure("图片不能超过 20 MB", 413);
  if (!/^(?:local|[0-9a-f-]{36})$/.test(userId)) throw failure("用户标识无效", 500);
  const image = detectImage(content, contentType);
  if (!isSuanliOssConfigured()) throw failure("服务端未配置可用的 OSS 图片上传", 503);
  const config = readClientConfig();
  const objectKey = `users/${userId}/suanli/${randomUUID()}.${image.extension}`;
  const url = objectPublicUrl(objectKey);
  try {
    await getClient(config).send(new PutObjectCommand({ Bucket: config.bucket, Key: objectKey, Body: content, ContentType: image.contentType }));
  } catch {
    throw failure("图片上传至对象存储失败", 502);
  }
  return url;
}

export function isOwnedSuanliImageUrl(value: string, userId: string) {
  if (!isSuanliOssConfigured()) return false;
  const base = publicBaseUrl();
  if (!/^(?:local|[0-9a-f-]{36})$/.test(userId) || !URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.origin !== base.origin || url.username || url.password || url.search || url.hash) return false;
  const basePath = base.pathname.replace(/\/+$/, "");
  const prefix = `${basePath}/users/${userId}/suanli/`;
  if (!url.pathname.startsWith(prefix)) return false;
  let fileName: string;
  try { fileName = decodeURIComponent(url.pathname.slice(prefix.length)); }
  catch { return false; }
  return /^[0-9a-f-]{36}\.(?:png|jpg|webp|gif)$/.test(fileName);
}
