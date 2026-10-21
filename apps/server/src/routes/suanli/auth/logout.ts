import { Router } from "express";
import type { Request } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

export default Router().post("/", async (req: Request, res) => {
  u.suanli.assertSuanliDesktopRequest(req);
  await u.suanli.clearSuanliSession();
  u.suanli.clearSuanliModelCache();
  res.set("Cache-Control", "no-store").json(success(null));
});
