import { Router } from "express";
import type { Request } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", async (req: Request, res) => {
  if (u.suanli.getSuanliSession()) u.suanli.assertSuanliDesktopRequest(req);
  res.json(success(await u.mediaGeneration.listMediaModels()));
});
