import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", async (req, res) => {
  const canManage = u.workspace.isLocalWorkspaceRequest(req);
  const tools = await u.plugins.listTools();
  res.json(success({ tools: u.workspace.canConfigureUser(req) ? tools : tools.map(tool => ({ ...tool, config: {} })), canManage, canConfigure: u.workspace.canConfigureUser(req) }));
});
