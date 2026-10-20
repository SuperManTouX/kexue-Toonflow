import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { chmod, lstat, mkdir, readFile, writeAtomic } from "@toonflow/file";
import type { SuanliIdentity } from "@/lib/userContext";
import { z } from "zod";

export type AuthUser = { id: string; name: string };
export type ServiceKind = "mcp" | "a2a";
const userSchema = z.object({ id: z.uuid(), name: z.string().min(1).max(256) });
const suanliIdentitySchema = z.object({
  userId: z.string().trim().min(1).max(256),
  sessionId: z.string().trim().min(1).max(4096),
  schoolId: z.string().trim().min(1).max(256).optional(),
});
const encryptedTokenSchema = z.object({
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  authTag: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  ciphertext: z.string().min(1).max(65536),
});
const identitySchema = z.object({ users: z.record(z.string(), userSchema), credentials: z.record(z.string(), z.object({ userId: z.uuid(), kind: z.enum(["mcp", "a2a"]) })) });
const sessionsSchema = z.record(z.string(), z.object({
  userId: z.uuid(),
  expiresAt: z.number().finite(),
  suanliIdentity: suanliIdentitySchema.optional(),
  suanliCredential: encryptedTokenSchema.optional(),
}));
let directory = "";
let identityKey: Buffer;
let identities: z.infer<typeof identitySchema> = { users: {}, credentials: {} };
let sessions: z.infer<typeof sessionsSchema> = {};
let queue = Promise.resolve();
export const sessionLifetime = 7 * 24 * 60 * 60 * 1000;

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = result.then(() => {}, () => {});
  return result;
}
export function hashCredential(value: string) { return createHash("sha256").update(value).digest("hex"); }
function findUser(id: string) { return Object.values(identities.users).find(user => user.id === id); }
function encryptSuanliToken(token: string, sessionHash: string, userId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", identityKey, iv);
  cipher.setAAD(Buffer.from(`${sessionHash}\0${userId}`));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64url"), authTag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
}
function decryptSuanliToken(credential: z.infer<typeof encryptedTokenSchema>, sessionHash: string, userId: string) {
  try {
    const decipher = createDecipheriv("aes-256-gcm", identityKey, Buffer.from(credential.iv, "base64url"));
    decipher.setAAD(Buffer.from(`${sessionHash}\0${userId}`));
    decipher.setAuthTag(Buffer.from(credential.authTag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(credential.ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("认证存储中的 SXWZ 凭证无法解密");
  }
}
async function loadJson(path: string) {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw new Error("认证存储无法读取");
  });
  if (!info) return undefined;
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("认证存储格式无效");
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("认证存储无法读取"); }
}
export async function initializeAuthStorage(root: string) {
  directory = join(root, "auth");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(directory);
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) throw new Error("认证目录必须是普通目录");
  await chmod(directory, 0o700);
  const keyPath = join(directory, "identityKey");
  const identitiesPath = join(directory, "identities.json");
  const sessionsPath = join(directory, "sessions.json");
  const loadedIdentitiesValue = await loadJson(identitiesPath);
  const loadedSessionsValue = await loadJson(sessionsPath);
  if (loadedIdentitiesValue !== undefined) await chmod(identitiesPath, 0o600);
  if (loadedSessionsValue !== undefined) await chmod(sessionsPath, 0o600);
  const keyInfo = await lstat(keyPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw new Error("认证密钥无法读取");
  });
  if (keyInfo && (keyInfo.isSymbolicLink() || !keyInfo.isFile())) throw new Error("认证密钥必须是普通文件");
  try { identityKey = await readFile(keyPath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("认证密钥无法读取");
    if (loadedIdentitiesValue !== undefined || loadedSessionsValue !== undefined) throw new Error("认证密钥缺失，不能重新生成并丢失既有身份绑定");
    try { await writeAtomic(keyPath, randomBytes(32), { exclusive: true, mode: 0o600 }); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause; }
    identityKey = await readFile(keyPath);
  }
  if (identityKey.length !== 32) throw new Error("认证密钥已损坏，不能重新生成并覆盖");
  await chmod(keyPath, 0o600);
  const loadedIdentities = identitySchema.safeParse(loadedIdentitiesValue ?? { users: {}, credentials: {} });
  const loadedSessions = sessionsSchema.safeParse(loadedSessionsValue ?? {});
  if (!loadedIdentities.success || !loadedSessions.success) throw new Error("认证存储格式无效");
  identities = loadedIdentities.data;
  sessions = Object.fromEntries(Object.entries(loadedSessions.data).filter(([, session]) => session.expiresAt > Date.now()));
  if (Object.keys(sessions).length !== Object.keys(loadedSessions.data).length) {
    await writeAtomic(sessionsPath, JSON.stringify(sessions), { mode: 0o600 });
  }
}
export function createStoredLogin(userName: string, externalSubject: string, suanliIdentity: SuanliIdentity, suanliToken: string) {
  return serialize(async () => {
    const subjectHash = createHmac("sha256", identityKey).update("sxwz\0").update(externalSubject).digest("hex");
    const user = { id: identities.users[subjectHash]?.id ?? randomUUID(), name: userName };
    const nextIdentities = { ...identities, users: { ...identities.users, [subjectHash]: user } };
    await writeAtomic(join(directory, "identities.json"), JSON.stringify(nextIdentities), { mode: 0o600 });
    identities = nextIdentities;
    const sessionToken = randomBytes(32).toString("base64url");
    const sessionHash = hashCredential(sessionToken);
    const expiresAt = Date.now() + sessionLifetime;
    const nextSessions = Object.fromEntries(Object.entries(sessions).filter(([, session]) => session.expiresAt > Date.now()));
    nextSessions[sessionHash] = {
      userId: user.id,
      expiresAt,
      suanliIdentity,
      suanliCredential: encryptSuanliToken(suanliToken, sessionHash, user.id),
    };
    await writeAtomic(join(directory, "sessions.json"), JSON.stringify(nextSessions), { mode: 0o600 });
    sessions = nextSessions;
    return { user, sessionToken, expiresAt };
  });
}
export async function resolveSession(token: string) {
  await queue;
  if (!/^[\w-]{43}$/.test(token)) return;
  const sessionHash = hashCredential(token);
  const session = sessions[sessionHash];
  if (!session) return;
  if (session.expiresAt <= Date.now()) {
    await serialize(async () => {
      const current = sessions[sessionHash];
      if (!current || current.expiresAt > Date.now()) return;
      const next = { ...sessions };
      delete next[sessionHash];
      await writeAtomic(join(directory, "sessions.json"), JSON.stringify(next), { mode: 0o600 });
      sessions = next;
    });
    return;
  }
  const user = findUser(session.userId);
  if (!user) return;
  return {
    user,
    sessionHash,
    expiresAt: session.expiresAt,
    suanliIdentity: session.suanliIdentity,
    suanliToken: session.suanliCredential ? decryptSuanliToken(session.suanliCredential, sessionHash, session.userId) : undefined,
  };
}
export async function findStoredUser(id: string) {
  await queue;
  return findUser(id);
}
export function revokeSession(sessionHash: string) {
  return serialize(async () => {
    const next = { ...sessions };
    delete next[sessionHash];
    await writeAtomic(join(directory, "sessions.json"), JSON.stringify(next), { mode: 0o600 });
    sessions = next;
  });
}
export function registerServiceCredential(userId: string, kind: ServiceKind, token?: string) {
  return serialize(async () => {
    const key = token ? hashCredential(token) : undefined;
    if (key && identities.credentials[key] && (identities.credentials[key]!.userId !== userId || identities.credentials[key]!.kind !== kind)) throw Object.assign(new Error("服务凭证已绑定其他用户或用途"), { status: 409 });
    const credentials = Object.fromEntries(Object.entries(identities.credentials).filter(([, item]) => item.userId !== userId || item.kind !== kind));
    if (key) credentials[key] = { userId, kind };
    const next = { ...identities, credentials };
    await writeAtomic(join(directory, "identities.json"), JSON.stringify(next), { mode: 0o600 });
    identities = next;
  });
}
export async function findServiceUser(kind: ServiceKind, token: string) {
  await queue;
  const credential = identities.credentials[hashCredential(token)];
  return credential?.kind === kind ? findUser(credential.userId) : undefined;
}
