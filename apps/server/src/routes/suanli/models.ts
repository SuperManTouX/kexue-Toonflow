import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

export default Router().get("/", async (_req, res) => {
  const models = await u.suanli.listSuanliModels(u.auth.getCurrentUser().suanliIdentity);
  res.json(success(models));
});
