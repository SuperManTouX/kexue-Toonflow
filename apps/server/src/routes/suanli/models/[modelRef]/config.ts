import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router({ mergeParams: true }).get("/", validateFields({ modelRef: z.string().trim().min(1).max(512) }, "params"), async (req, res) => {
  const modelRef = req.params.modelRef;
  if (typeof modelRef !== "string") throw Object.assign(new Error("模型标识无效"), { status: 400 });
  const params = await u.suanli.getSuanliModelConfig(modelRef, u.auth.getCurrentUser().suanliIdentity);
  res.json(success({ params, imageUploadAvailable: u.suanli.isSuanliOssConfigured() }));
});
