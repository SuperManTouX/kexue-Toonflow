import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { readSessionCookie } from "@/utils/auth/middleware";
import { closeSessionResponses } from "@/lib/userContext";

const attempts = new Map<string, { count: number; expires: number }>();
let active = 0;

export default Router().post("/", validateFields({ sxwzToken: z.string().trim().min(1).max(8192) }), async (req, res) => {
  if (u.auth.getAuthMode() !== "sxwz") throw Object.assign(new Error("本地模式不使用外部登录"), { status: 403 });
  const now = Date.now();
  for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
  const key = req.socket.remoteAddress ?? "unknown";
  let attempt = attempts.get(key);
  if (!attempt) {
    if (attempts.size >= 10000) throw Object.assign(new Error("登录请求过多，请稍后重试"), { status: 429 });
    attempts.set(key, attempt = { count: 0, expires: now + 60000 });
  }
  if (++attempt.count > 20 || active >= 20) throw Object.assign(new Error("登录请求过多，请稍后重试"), { status: 429 });
  active++;
  try {
    const result = await u.auth.createLogin(req.body.sxwzToken.trim());
    u.auth.runWithUser(u.auth.createUserContext(result.user.id, result.user.name), () => u.conf);
    const previous = await u.auth.resolveSession(readSessionCookie(req));
    if (previous) {
      await u.auth.revokeSession(previous.sessionHash);
      closeSessionResponses(previous.sessionHash);
    }
    res.cookie("toonflowSession", result.sessionToken, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV !== "dev", path: "/", maxAge: u.auth.sessionLifetime });
    res.set("Cache-Control", "no-store").json(success({ user: result.user }));
  } finally { active--; }
});
