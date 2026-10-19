import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

export default Router().post("/", async (req, res) => {
  if (!req.is("application/octet-stream") || !Buffer.isBuffer(req.body)) {
    throw Object.assign(new Error("请发送图片原始内容"), { status: 400 });
  }
  const url = await u.suanli.uploadSuanliImage(u.auth.getCurrentUser().userId, req.body, req.get("x-file-content-type") ?? "");
  res.json(success({ url }));
});
