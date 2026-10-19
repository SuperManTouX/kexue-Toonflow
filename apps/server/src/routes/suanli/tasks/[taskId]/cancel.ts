import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router({ mergeParams: true }).post("/", validateFields({ taskId: z.uuid() }, "params"), async (req, res) => {
  const taskId = req.params.taskId;
  if (typeof taskId !== "string") throw Object.assign(new Error("任务标识无效"), { status: 400 });
  res.json(success(await u.suanli.cancelSuanliTask(taskId)));
});
