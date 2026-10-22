import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", validateFields({ modelRef: z.string().trim().min(1).max(256) }, "query"), async (req: Request, res) => {
  u.suanli.assertSuanliDesktopRequest(req);
  const template = await u.suanli.readSuanliMediaTemplate(req.query.modelRef as string);
  res.set("Cache-Control", "no-store").json(success({
    ...template,
    params: template.params.map(param => {
      if (param.ui !== "hidden" && param.ui !== "imageUpload") return param;
      const safeParam = { ...param };
      delete safeParam.default;
      return safeParam;
    }),
  }));
});
