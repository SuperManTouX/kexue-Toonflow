import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { chmod, lstat, mkdir, readFile, unlink, writeAtomic } from "@toonflow/file";
import { z } from "zod";
import type { SuanliCaptcha } from "./types";

export type SuanliIdentity = {
  userId: string;
  name: string;
  sessionId: string;
  schoolId: string;
  collegeId?: string;
};
type SuanliSession = { token: string; identity: SuanliIdentity };

const identitySchema = z.object({
  userId: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  sessionId: z.string().min(1).max(4096),
  schoolId: z.string().min(1).max(128),
  collegeId: z.string().min(1).max(128).optional(),
});
const sessionSchema = z.object({ token: z.string().min(1).max(8192), identity: identitySchema });
const envelopeSchema = z.object({ version: z.literal(1), iv: z.string(), tag: z.string(), ciphertext: z.string() });
const responseSchema = z.object({ status: z.number().int(), message: z.string().optional(), data: z.unknown().optional() });
const captchaSchema = z.object({
  captchaId: z.string().min(1).max(128),
  captchaImage: z.string().min(1).max(256 * 1024),
});
const defaultSxwzBaseUrl = "https://sxwz.xueai.art";
const maxAuthResponseBytes = 1024 * 1024;
let keyPath = "";
let sessionPath = "";
let identityKey: Buffer | undefined;
let keyInvalid = false;
let session: SuanliSession | undefined;
let storageQueue = Promise.resolve();
let sessionRevision = 0;
let loginRevision = 0;
let pendingLoginRevision: number | undefined;
let pendingInvalidSessionRevision: number | undefined;

function failure(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function sanitizeUpstreamMessage(message: string, secrets: string[]) {
  const sanitizedMessage = secrets.filter(Boolean).reduce((value, secret) => value.replaceAll(secret, "[REDACTED]"), message);
  return sanitizedMessage.replace(/[\r\n\t]/g, " ").slice(0, 256);
}

function serialize<T>(operation: () => Promise<T>) {
  const result = storageQueue.then(operation);
  storageQueue = result.then(() => {}, () => {});
  return result;
}

export function getSxwzBaseUrl() {
  const value = process.env.SXWZ_BASE_URL?.trim() || defaultSxwzBaseUrl;
  if (!URL.canParse(value)) throw failure("SXWZ 服务地址配置无效", 500);
  const base = new URL(value);
  const allowHttp = process.env.NODE_ENV === "dev";
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/"
    || (base.protocol !== "https:" && !(allowHttp && base.protocol === "http:"))) {
    throw failure("SXWZ 服务地址必须是 HTTPS 基础域名", 500);
  }
  return base.origin;
}

function getSxwzUrl(path: string) {
  return new URL(path, getSxwzBaseUrl());
}

async function readJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw failure("SXWZ 返回了无效响应", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxAuthResponseBytes) {
        await reader.cancel();
        throw failure("SXWZ 响应超过大小限制", 502);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof Error && "status" in error) throw error;
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw failure("SXWZ 响应读取超时", 504);
    throw failure("SXWZ 返回了无效响应", 502);
  } finally { reader.releaseLock(); }
}

async function requestSxwz(path: string, body?: Record<string, string>, token?: string, method: "GET" | "POST" = "POST") {
  let response: Response;
  try {
    response = await fetch(getSxwzUrl(path), {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(method === "POST" && body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    throw failure(timeout ? "SXWZ 请求超时，请稍后重试" : "SXWZ 服务暂不可用", timeout ? 504 : 502);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw failure(response.status === 401 || response.status === 403 ? "SXWZ 登录失败，请检查账号和密码" : "SXWZ 服务暂不可用", response.status === 401 || response.status === 403 ? 401 : 502);
  }
  const value = await readJson(response);
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw failure("SXWZ 返回了无效响应", 502);
  return parsed.data;
}

function readId(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^\d{1,128}$/.test(value.trim())) return value.trim();
  return undefined;
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readIdentity(value: unknown): SuanliIdentity {
  const userInfo = objectValue(value);
  const student = objectValue(userInfo.eduStudent);
  const teacher = objectValue(userInfo.eduTeacher);
  const college = objectValue(userInfo.eduCollege);
  const userId = readId(userInfo.userId);
  const schoolId = readId(userInfo.schoolId) ?? readId(student.schoolId) ?? readId(teacher.schoolId) ?? readId(college.schoolId);
  const sessionId = typeof userInfo.sessionId === "string" ? userInfo.sessionId.trim() : "";
  if (!userId || !schoolId || !sessionId || sessionId.length > 4096) {
    throw failure("SXWZ 登录身份缺少用户、学校或会话信息，无法使用算力服务", 401);
  }
  const name = [userInfo.nickname, userInfo.realName, userInfo.userName].find(item => typeof item === "string" && item.trim());
  const identity = identitySchema.safeParse({
    userId,
    name: typeof name === "string" ? name.trim().slice(0, 256) : userId,
    sessionId,
    schoolId,
    collegeId: readId(student.collegeId) ?? readId(teacher.collegeId) ?? readId(college.id),
  });
  if (!identity.success) throw failure("SXWZ 登录身份格式无效", 401);
  return identity.data;
}

async function readRegularFile(path: string, label: string) {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw failure(`本机 ${label} 无法读取`, 500);
  });
  if (!info) return undefined;
  if (info.isSymbolicLink() || !info.isFile() || info.size > 65536) throw failure(`本机 ${label} 格式无效`, 500);
  await chmod(path, 0o600);
  return await readFile(path);
}

async function createIdentityKey() {
  try { await writeAtomic(keyPath, randomBytes(32), { exclusive: true, mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const key = await readRegularFile(keyPath, "SXWZ 密钥");
  if (!key || key.length !== 32) throw failure("本机 SXWZ 密钥格式无效", 500);
  identityKey = key;
  keyInvalid = false;
}

function decryptSession(value: Buffer, key: Buffer) {
  try {
    const parsed = envelopeSchema.safeParse(JSON.parse(value.toString("utf8")));
    if (!parsed.success) return undefined;
    const envelope = parsed.data;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]);
    const stored = sessionSchema.safeParse(JSON.parse(plaintext.toString("utf8")));
    return stored.success ? stored.data : undefined;
  } catch { return undefined; }
}

function encryptSession(value: SuanliSession, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  });
}

export async function initializeSuanliSession(root: string) {
  const authDirectory = join(resolve(root), "auth");
  await mkdir(authDirectory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(authDirectory);
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) throw failure("本机认证目录必须是普通目录", 500);
  await chmod(authDirectory, 0o700);
  keyPath = join(authDirectory, "suanliKey");
  sessionPath = join(authDirectory, "suanliSession.json");

  const stored = await readRegularFile(sessionPath, "SXWZ 会话");
  const key = await readRegularFile(keyPath, "SXWZ 密钥");
  keyInvalid = Boolean(key && key.length !== 32);
  if (keyInvalid) {
    identityKey = undefined;
    session = undefined;
    return;
  }
  if (!key && stored) {
    session = undefined;
    identityKey = undefined;
    return;
  }
  if (!key) await createIdentityKey();
  else identityKey = key;
  session = stored && identityKey ? decryptSession(stored, identityKey) : undefined;
}

export function getSuanliSession() {
  return session ? { token: session.token, identity: { ...session.identity } } : undefined;
}

export function getSuanliSessionRevision() {
  return sessionRevision;
}

export async function getSuanliCaptcha(): Promise<SuanliCaptcha> {
  const response = await requestSxwz("/api/captcha/generate", undefined, undefined, "GET");
  if (response.status !== 1000) throw failure("SXWZ 验证码获取失败", 502);
  const captcha = captchaSchema.safeParse(response.data);
  if (!captcha.success) throw failure("SXWZ 验证码响应格式无效", 502);
  return captcha.data;
}

export async function loginSuanli(username: string, password: string, captchaId: string, captchaValue: string) {
  const revision = ++loginRevision;
  pendingLoginRevision = revision;
  try {
    const passwordHash = createHash("md5").update(password).digest("hex");
    const login = await requestSxwz("/api/login/appLogin", { username, password: passwordHash, captchaId, captchaValue });
    if (login.status !== 1000) {
      console.error("SXWZ appLogin 业务失败", {
        upstreamStatus: login.status,
        upstreamMessage: login.message ? sanitizeUpstreamMessage(login.message, [username, password, captchaId, captchaValue]) : undefined,
      });
      throw failure("SXWZ 登录失败，请检查账号和密码", 401);
    }
    const loginData = z.object({ token: z.string().min(1).max(8192).refine(value => !!value.trim()) }).safeParse(login.data);
    if (!loginData.success) throw failure("SXWZ 登录响应缺少有效 token", 502);

    const validation = await requestSxwz("/api/login/validateToken", undefined, loginData.data.token);
    if (validation.status !== 1000) throw failure("SXWZ 登录 token 无效，请重试", 401);
    const userInfo = z.object({ userInfo: z.unknown() }).safeParse(validation.data);
    if (!userInfo.success) throw failure("SXWZ 未返回有效的登录身份", 401);
    const identity = readIdentity(userInfo.data.userInfo);
    const nextSession = sessionSchema.parse({ token: loginData.data.token, identity });

    await serialize(async () => {
      if (revision !== loginRevision) throw failure("登录状态已变化，此次登录已取消", 409);
      if (!identityKey) {
        await unlink(sessionPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
        if (keyInvalid) await unlink(keyPath);
        await createIdentityKey();
      }
      if (revision !== loginRevision) throw failure("登录状态已变化，此次登录已取消", 409);
      const previousSession = session;
      const writeRevision = sessionRevision;
      await writeAtomic(sessionPath, encryptSession(nextSession, identityKey!), { mode: 0o600 });
      if (revision !== loginRevision || writeRevision !== sessionRevision) {
        if (previousSession && identityKey) {
          await writeAtomic(sessionPath, encryptSession(previousSession, identityKey), { mode: 0o600 });
        } else {
          await unlink(sessionPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
        }
        throw failure("登录状态已变化，此次登录已取消", 409);
      }
      sessionRevision += 1;
      session = nextSession;
      pendingInvalidSessionRevision = undefined;
    });
    return identity;
  } finally {
    if (pendingLoginRevision === revision) {
      pendingLoginRevision = undefined;
      const invalidRevision = pendingInvalidSessionRevision;
      pendingInvalidSessionRevision = undefined;
      if (invalidRevision === sessionRevision) await clearSuanliSession(invalidRevision);
    }
  }
}

export function clearSuanliSession(expectedSessionRevision?: number) {
  if (expectedSessionRevision !== undefined) {
    if (expectedSessionRevision !== sessionRevision) return Promise.resolve(false);
    if (pendingLoginRevision !== undefined) {
      pendingInvalidSessionRevision = expectedSessionRevision;
      return Promise.resolve(false);
    }
  }
  loginRevision += 1;
  pendingLoginRevision = undefined;
  pendingInvalidSessionRevision = undefined;
  sessionRevision += 1;
  return serialize(async () => {
    await unlink(sessionPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    session = undefined;
    return true;
  });
}
