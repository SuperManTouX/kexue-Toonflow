import { Router } from "express";
import type { Request } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

export default Router().get("/", async (req: Request, res) => {
  u.suanli.assertSuanliDesktopRequest(req);
  res.set("Cache-Control", "no-store").json(success(await u.suanli.listSuanliModels()));
});
