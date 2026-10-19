import { Router } from "express";
import u from "@/utils";
import { readSessionCookie } from "@/utils/auth/middleware";
import { success } from "@/lib/responseFormat";

export default Router().get("/", async (req, res) => {
  const mode = u.auth.getAuthMode();
  const user = mode === "local" ? { id: "local", name: "本地用户" } : (await u.auth.resolveSession(readSessionCookie(req)))?.user ?? null;
  res.set("Cache-Control", "no-store").json(success({ mode, user }));
});
