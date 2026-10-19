import u from "@/utils";
import { Router } from "express";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.set("Cache-Control", "no-store");
  const { default: initializeProviderModels } = await import("@/utils/ai/initialize");
  await initializeProviderModels();
  const settings = u.conf.get("settings", {});
  if (u.cleanNodeMenuSettings(settings)) u.conf.set("settings", settings);
  res.json(success(settings));
});
