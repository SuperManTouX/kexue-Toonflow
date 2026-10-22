import { Router } from "express";

export default Router().get("/", (req, res) => {
  if (!req.app.locals.desktop) return res.sendStatus(404);
  res.set("Cache-Control", "no-store").json({ mode: "local", appVersion: req.app.locals.appVersion });
});
