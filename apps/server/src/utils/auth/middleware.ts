import type { Request, RequestHandler } from "express";
import { createUserContext, getAuthMode, runWithUser, trackSessionResponse } from "@/lib/userContext";
import { findStoredUser, resolveSession } from "./storage";
import { resolveServiceCredential } from "./index";
import { consumeInternalRequest, rememberInternalRequest, verifyInternalRequest } from "./internalRequest";

export function assertSameOrigin(req: Request) {
  const source = req.get("origin") ?? req.get("referer");
  const expected = process.env.TOONFLOW_PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`;
  if (!source || !URL.canParse(source) || !URL.canParse(expected) || new URL(source).origin !== new URL(expected).origin) {
    throw Object.assign(new Error("只允许同源页面请求"), { status: 403 });
  }
}
export function readSessionCookie(req: Request) {
  return req.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith("toonflowSession="))?.slice(16) ?? "";
}

export function isHostOperation(path: string) {
  const normalizedPath = path.toLowerCase().replace(/\/+$/, "") || "/";
  return /^\/api\/(?:desktop(?:\/|$)|mobilelink(?:\/|$)|providers\/debug(?:\/|$)|providers\/media\/(?:add|delete|validate)$|(?:nodes|tools|ext|agents)\/(?:install|uninstall)$|plugins\/export$|ffmpeg\/(?:download|cancel|progress|events)$)/.test(normalizedPath);
}

export const authRequest: RequestHandler = async (req, res, next) => {
  if (getAuthMode() === "local") return next();
  const path = req.path.toLowerCase().replace(/\/+$/, "") || "/";
  if (!/^\/(?:api|mcp|a2a)(?:\/|$)/.test(path)) return next();
  try {
    if (["/api/auth/get", "/api/auth/login"].includes(path)) {
      if (req.method === "POST") assertSameOrigin(req);
      return next();
    }
    const bearer = req.get("authorization")?.match(/^Bearer (.{1,8192})$/)?.[1];
    const isApiRequest = path.startsWith("/api/");
    const internalToken = req.get("x-toonflow-internal");
    if (internalToken && !isApiRequest) throw Object.assign(new Error("内部请求凭证用途无效"), { status: 401 });
    if (isApiRequest && internalToken) {
      const claims = verifyInternalRequest(req);
      if (!claims) throw Object.assign(new Error("内部请求凭证无效"), { status: 401 });
      assertSameOrigin(req);
      const user = await findStoredUser(claims.userId);
      if (!user) throw Object.assign(new Error("内部请求用户不存在"), { status: 401 });
      rememberInternalRequest(req, claims, user);
      res.vary("Authorization");
      res.set("Cache-Control", "private, no-store");
      if (isHostOperation(path)) throw Object.assign(new Error("多用户服务不允许管理宿主程序或执行供应商源码"), { status: 403 });
      return next();
    }
    const session = isApiRequest ? await resolveSession(readSessionCookie(req)) : undefined;
    const serviceKind = path.startsWith("/mcp") ? "mcp" : path.startsWith("/a2a") ? "a2a" : undefined;
    const serviceUser = !session && serviceKind && bearer ? await resolveServiceCredential(serviceKind, bearer) : undefined;
    const user = session?.user ?? serviceUser;
    if (!user) throw Object.assign(new Error("请先通过 SXWZ 登录"), { status: 401 });
    res.vary("Cookie");
    res.vary("Authorization");
    res.set("Cache-Control", "private, no-store");
    if (isHostOperation(path)) throw Object.assign(new Error("多用户服务不允许管理宿主程序或执行供应商源码"), { status: 403 });
    if (session) {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) assertSameOrigin(req);
      const expectedUser = req.get("x-toonflow-user") ?? req.query.toonflowUser;
      if (expectedUser !== user.id) throw Object.assign(new Error("登录用户已变化，请重新打开页面"), { status: 409, code: "EAUTHCHANGED" });
      if (path !== "/api/auth/logout") trackSessionResponse(res, session.sessionHash, session.expiresAt);
    }
    runWithUser(createUserContext(user.id, user.name, session?.sessionHash, session?.suanliIdentity, session?.suanliToken), next);
  } catch (error) { next(error); }
};

export const internalAuthRequest: RequestHandler = (req, _res, next) => {
  try {
    const user = consumeInternalRequest(req);
    if (!user) return next();
    runWithUser(createUserContext(user.id, user.name), next);
  } catch (error) { next(error); }
};
