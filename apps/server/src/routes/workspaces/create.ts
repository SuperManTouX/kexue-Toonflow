import { mkdir, rmdir, writeAtomic } from "@toonflow/file";
import { Buffer } from "node:buffer";
import { dirname, join, resolve } from "node:path";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

const router = Router();
const projectNameSchema = z.string().trim().min(1).max(80);

export default router.post("/", validateFields({ name: projectNameSchema }), async (req, res) => {
  const name = (req.body.name as string).trim();
  if (name === "." || name === ".." || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || Buffer.byteLength(name, "utf8") > 240) {
    return res.status(400).json(error("项目名称包含不支持的字符或格式", null, 400));
  }

  const workspaceRoot = resolve(dirname(u.conf.path), "workspaces");
  await mkdir(workspaceRoot, { recursive: true });
  const { path: directory } = await u.workspaceFile.resolveWorkspacePath(workspaceRoot, name);
  let release: (() => void) | undefined;
  let createdDirectory = false;
  try {
    release = u.workspaceFile.lockWorkspaceFiles([directory]);
    await mkdir(directory);
    createdDirectory = true;
    await writeAtomic(join(directory, "画布1.json"), JSON.stringify({
      toonflowCanvas: true,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }), { exclusive: true });
  } catch (cause) {
    if (createdDirectory) await rmdir(directory).catch(() => undefined);
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return res.status(409).json(error("已有同名项目，请更换项目名称", null, 409));
    if (code === "EBUSY") return res.status(409).json(error("项目正在创建或使用，请稍后重试", null, 409));
    throw cause;
  } finally {
    release?.();
  }
  res.json(success({ directory }));
});
