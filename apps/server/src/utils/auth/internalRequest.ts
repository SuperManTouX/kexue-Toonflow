import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { AuthUser } from "./storage";

type InternalRequest = { userId: string; nonce: string; expiresAt: number; bodyHash: string };
const signingKey = randomBytes(32);
const pendingRequests = new WeakMap<Request, { claims: InternalRequest; user: AuthUser }>();
const bodyHashes = new WeakMap<Request, string>();
const consumedNonces = new Map<string, number>();
const emptyBodyHash = createHash("sha256").digest("base64url");

function hashBody(body?: string | ArrayBuffer) {
  return createHash("sha256").update(typeof body === "string" ? body : body ? Buffer.from(body) : Buffer.alloc(0)).digest("base64url");
}

function signature(userId: string, method: string, target: string, bodyHash: string, timestamp: number, nonce: string) {
  return createHmac("sha256", signingKey).update(userId).update("\0").update(method.toUpperCase()).update("\0")
    .update(target).update("\0").update(bodyHash).update("\0").update(String(timestamp)).update("\0").update(nonce).digest("base64url");
}

export function createInternalRequestToken(userId: string, method: string, target: string, body?: string | ArrayBuffer) {
  const timestamp = Date.now();
  const nonce = randomBytes(16).toString("base64url");
  const bodyHash = hashBody(body);
  return `v1.${timestamp}.${nonce}.${bodyHash}.${signature(userId, method, target, bodyHash, timestamp, nonce)}`;
}

export function verifyInternalRequest(req: Request) {
  const token = req.get("x-toonflow-internal");
  if (!token) return;
  const userId = req.get("x-toonflow-user") ?? "";
  const match = /^v1\.(\d{13})\.([\w-]{22})\.([\w-]{43})\.([\w-]{43})$/.exec(token);
  if (!match || !/^[0-9a-f-]{36}$/i.test(userId)) throw Object.assign(new Error("内部请求凭证无效"), { status: 401 });
  const timestamp = Number(match[1]);
  const expiresAt = timestamp + 30000;
  const bodyHash = match[3]!;
  const actual = Buffer.from(match[4]!, "base64url");
  const expected = Buffer.from(signature(userId, req.method, req.originalUrl, bodyHash, timestamp, match[2]!), "base64url");
  if (timestamp > Date.now() || expiresAt <= Date.now() || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw Object.assign(new Error("内部请求凭证无效"), { status: 401 });
  }
  return { userId, nonce: match[2]!, expiresAt, bodyHash };
}

export function rememberInternalRequest(req: Request, claims: InternalRequest, user: AuthUser) {
  pendingRequests.set(req, { claims, user });
}

export function captureInternalRequestBody(req: Request, _res: Response, buffer: Buffer) {
  bodyHashes.set(req, createHash("sha256").update(buffer).digest("base64url"));
}

export function consumeInternalRequest(req: Request) {
  const pending = pendingRequests.get(req);
  if (!pending) return;
  pendingRequests.delete(req);
  const actual = Buffer.from(bodyHashes.get(req) ?? emptyBodyHash, "base64url");
  const expected = Buffer.from(pending.claims.bodyHash, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Object.assign(new Error("内部请求内容不匹配"), { status: 401 });
  for (const [nonce, expiresAt] of consumedNonces) if (expiresAt <= Date.now()) consumedNonces.delete(nonce);
  if (consumedNonces.has(pending.claims.nonce)) throw Object.assign(new Error("内部请求凭证已使用"), { status: 401 });
  if (consumedNonces.size >= 10000) throw Object.assign(new Error("内部请求过多，请稍后重试"), { status: 429 });
  consumedNonces.set(pending.claims.nonce, pending.claims.expiresAt);
  return pending.user;
}
