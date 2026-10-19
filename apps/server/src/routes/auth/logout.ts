import { Router } from "express";
import u from "@/utils";
import { closeSessionResponses } from "@/lib/userContext";
import { success } from "@/lib/responseFormat";

export default Router().post("/", async (_req, res) => {
  const sessionHash = u.auth.getCurrentUser().sessionHash;
  if (sessionHash) {
    await u.auth.revokeSession(sessionHash);
    closeSessionResponses(sessionHash);
  }
  res.clearCookie("toonflowSession", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV !== "dev", path: "/" });
  res.set("Cache-Control", "no-store").json(success(null));
});
