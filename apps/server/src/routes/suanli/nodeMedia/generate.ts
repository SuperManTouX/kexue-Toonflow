import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { errorFromCause, success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({
  directory: z.string().min(1).max(4096),
  outputDirectory: z.string().min(1).max(4096),
  mediaType: z.enum(["image", "video", "audio"]),
  modelRef: z.string().trim().min(1).max(512),
  body: z.record(z.string(), z.unknown()),
}), async (req, res) => {
  const { directory, outputDirectory, mediaType, modelRef, body } = req.body;
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  const controller = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const close = () => { clearInterval(heartbeat); controller.abort(); };
  res.once("close", close);
  req.once("aborted", close);
  req.socket.once("close", close);
  try {
    res.set({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": u.auth.canManageHost() ? "no-cache, no-transform" : "private, no-store, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded && !res.writableNeedDrain) res.write("\n"); }, 20000);
    const files = await u.suanli.generateSuanliNodeMedia(cwd, outputDirectory, mediaType, modelRef, body, controller.signal);
    if (!res.destroyed) res.write(JSON.stringify(success(files)));
  } catch (cause) {
    if (!res.destroyed) res.write(JSON.stringify(errorFromCause(cause)));
  } finally {
    clearInterval(heartbeat);
    res.off("close", close);
    req.off("aborted", close);
    req.socket.off("close", close);
    res.end();
  }
});
