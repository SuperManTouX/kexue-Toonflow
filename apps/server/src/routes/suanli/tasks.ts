import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({
  modelRef: z.string().trim().min(1).max(512),
  body: z.record(z.string(), z.unknown()),
  directory: z.string().min(1).max(4096),
  sessionFile: z.string().regex(/^[\w-]+\.jsonl$/).optional(),
  messageId: z.uuid(),
}), async (req, res) => {
  const { modelRef, body, directory, messageId } = req.body as {
    modelRef: string; body: Record<string, unknown>; directory: string; messageId: string;
  };
  let sessionFile = req.body.sessionFile as string | undefined;
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  try {
    const result = await u.suanli.createSuanliTask(modelRef, body, async task => {
      if (!sessionFile) sessionFile = (await u.agent.createAgentConversation(cwd)).file;
      else {
        const session = await u.workspaceFile.resolveWorkspaceFile(req, directory, `.agent/sessions/${sessionFile}`);
        await u.agent.getAgentSession(cwd, session.path);
      }
      await u.agent.appendSuanliTaskMessage(cwd, sessionFile, {
        messageId,
        modelLabel: task.modelLabel,
        task: { clientTaskId: task.clientTaskId, modelLabel: task.modelLabel, status: "checking" },
      });
    });
    try {
      await u.agent.updateSuanliTaskMessage(cwd, sessionFile!, messageId, result);
    } catch {
      res.status(502).json(error("任务已创建，状态将在查询时同步", { ...result, messageId, sessionFile }, 502));
      return;
    }
    res.json(success({ ...result, messageId, sessionFile }));
  } catch (cause) {
    const failure = cause as Error & { status?: number; clientTaskId?: string };
    if (!failure.clientTaskId) throw cause;
    const status = failure.status ?? 502;
    res.status(status).json(error(failure.message, {
      clientTaskId: failure.clientTaskId, messageId, ...(sessionFile ? { sessionFile } : {}),
    }, status));
  }
});
