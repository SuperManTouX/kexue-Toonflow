const hostRequestKey = Symbol.for("toonflow.hostRequest");
export type HostRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const host = globalThis as typeof globalThis & { [hostRequestKey]?: HostRequest };

export function setHostRequest(request: HostRequest) { host[hostRequestKey] = request; }
export const hostRequest: HostRequest = (input, init) => (host[hostRequestKey] ?? fetch)(input, init);
