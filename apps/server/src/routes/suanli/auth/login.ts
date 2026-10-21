import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const inputSchema = z.object({
  username: z.string().trim().min(1).max(256),
  password: z.string().min(1).max(4096),
  captchaId: z.string().trim().min(1).max(128),
  captchaValue: z.string().trim().min(1).max(128),
});
const attempts = new Map<string, { count: number; expires: number }>();
let active = 0;

function requireLocalRequest(req: Request) {
  u.suanli.assertSuanliDesktopRequest(req);
}

export default Router().post("/", (req, _res, next) => {
  try { requireLocalRequest(req); next(); }
  catch (error) { next(error); }
}, validateFields(inputSchema.shape), async (req, res) => {
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
    const { username, password, captchaId, captchaValue } = req.body as z.infer<typeof inputSchema>;
    const identity = await u.suanli.loginSuanli(username.trim(), password, captchaId.trim(), captchaValue.trim());
    u.suanli.clearSuanliModelCache();
    res.set("Cache-Control", "no-store").json(success({ user: { id: identity.userId, name: identity.name } }));
  } finally { active--; }
});
