import { Router } from "express";
import type { Request } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

export default Router().get("/", (req: Request, res) => {
  u.suanli.assertSuanliDesktopRequest(req);
  const identity = u.suanli.getSuanliSession()?.identity;
  res.set("Cache-Control", "no-store").json(success({ user: identity ? { id: identity.userId, name: identity.name } : null }));
});
