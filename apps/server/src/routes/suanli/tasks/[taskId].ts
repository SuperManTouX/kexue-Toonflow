import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router({ mergeParams: true }).get("/", validateFields({ taskId: z.uuid() }, "params"), validateFields({
  directory: z.string().min(1).max(4096).optional(),
  sessionFile: z.string().regex(/^[\w-]+\.jsonl$/).optional(),
  messageId: z.uuid().optional(),
}, "query"), async (req, res) => {
  const taskId = req.params.taskId;
  if (typeof taskId !== "string") throw Object.assign(new Error("任务标识无效"), { status: 400 });
  const { directory, sessionFile, messageId } = req.query as {
    directory?: string; sessionFile?: string; messageId?: string;
  };
  if (Boolean(directory) !== Boolean(sessionFile) || Boolean(directory) !== Boolean(messageId)) {
    throw Object.assign(new Error("对话任务信息不完整"), { status: 400 });
  }
  try {
    const task = await u.suanli.getSuanliTask(taskId);
    if (directory && sessionFile && messageId && ["completed", "failed", "cancelled", "timeout"].includes(task.status)) {
      const cwd = await u.workspace.resolveWorkspace(req, directory);
      const session = await u.workspaceFile.resolveWorkspaceFile(req, directory, `.agent/sessions/${sessionFile}`);
      await u.agent.getAgentSession(cwd, session.path);
      await u.agent.updateSuanliTaskMessage(cwd, sessionFile, messageId, task);
    }
    res.json(success(task));
  } catch (cause) {
    if ((cause as { status?: number }).status !== 404 || !directory || !sessionFile || !messageId) throw cause;
    const cwd = await u.workspace.resolveWorkspace(req, directory);
    const session = await u.workspaceFile.resolveWorkspaceFile(req, directory, `.agent/sessions/${sessionFile}`);
    const conversation = await u.agent.getAgentSession(cwd, session.path);
    const storedTask = conversation.messages.find(message => message.id === messageId)?.task;
    if (!storedTask || (storedTask.clientTaskId !== taskId && storedTask.taskId !== taskId)) throw cause;
    const error = "任务记录已过期或任务已不可用，无法继续查询";
    const task = { ...storedTask, status: "unavailable" as const, error };
    await u.agent.updateSuanliTaskMessage(cwd, sessionFile, messageId, task);
    res.json(success(task));
  }
});
