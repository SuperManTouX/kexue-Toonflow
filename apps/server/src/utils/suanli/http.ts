import type { Request } from "express";
import { assertSameOrigin } from "@/utils/auth/middleware";
import { canManageHost } from "@/lib/userContext";

export function assertSuanliDesktopRequest(req: Request) {
  if (!canManageHost() || !req.app.locals.desktop || req.hostname !== "127.0.0.1") {
    throw Object.assign(new Error("SXWZ 算力仅在本机桌面客户端中可用"), { status: 403 });
  }
  assertSameOrigin(req);
}
