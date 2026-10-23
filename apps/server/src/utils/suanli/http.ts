import type { Request } from "express";
import { assertSameOrigin } from "@/utils/auth/middleware";
import { canManageHost } from "@/lib/userContext";
import { isLocalDesktopHost } from "@/lib/localRequest";

export function assertSuanliDesktopRequest(req: Request) {
  if (!canManageHost() || !req.app.locals.desktop || !isLocalDesktopHost(req)) {
    throw Object.assign(new Error("SXWZ 算力仅在本机桌面客户端中可用"), { status: 403 });
  }
  assertSameOrigin(req);
}
