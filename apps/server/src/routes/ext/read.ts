import { lstat } from "@toonflow/file";
import { resolve } from "node:path";
import { Router } from "express";
import u from "@/utils";
import { sendFile } from "@/utils/fileHttp";
import { validateFields } from "@/lib/middleware";
import { error } from "@/lib/responseFormat";

export default Router().get("/", validateFields({ name: u.extPlugins.extNameSchema }, "query"), async (req, res) => {
  const name = req.query.name as string;
  const path = resolve(u.extPlugins.extDirectory, `${name}.umd.js`);
  const file = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  if (!file?.isFile()) return res.status(404).json(error("文件扩展不存在", null, 404));
  if (!u.isResourceEnabled("ext", name)) return res.status(404).json(error("文件扩展已禁用", null, 404));
  res.set("Cache-Control", u.auth.canManageHost() ? "no-cache" : "private, no-store");
  await sendFile(res, path);
});
