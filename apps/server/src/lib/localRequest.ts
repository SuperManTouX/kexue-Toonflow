import type { Request } from "express";

const loopbackAddresses = ["127.0.0.1", "::1"];
const loopbackHosts = ["localhost", "127.0.0.1", "::1", "[::1]"];

function isLoopbackAddress(address: string) {
  const normalizedAddress = address.startsWith("::ffff:") ? address.slice(7) : address;
  return loopbackAddresses.includes(normalizedAddress);
}

function isSameOriginRequest(req: Request) {
  const expectedOrigin = `${req.protocol}://${req.get("host")}`;
  const origin = req.get("origin");
  return origin === undefined ? req.get("referer")?.startsWith(`${expectedOrigin}/`) === true : origin === expectedOrigin;
}

export function isLocalDesktopHost(req: Request) {
  const localHost = loopbackHosts.includes(req.hostname);
  const localSocket = isLoopbackAddress(req.socket.remoteAddress ?? "");
  if (localSocket && localHost && req.get("x-toonflow-local-client") !== "0") return true;

  return process.env.NODE_ENV === "dev" && process.platform === "linux" &&
    process.env.TOONFLOW_DEV_DESKTOP_WEB === "1" && process.env.TOONFLOW_DEV_LAN === "1" &&
    localSocket && req.get("x-toonflow-dev-lan-client") === "1" && isSameOriginRequest(req);
}
