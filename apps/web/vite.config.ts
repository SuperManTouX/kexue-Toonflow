import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { BlockList, isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import desktopConfig from "../../electrobun.config.ts";
import postcssConfig from "../../postcss.config.ts";
import { i18nPlugin } from "@toonflow/i18n/vite";

const desktopWebDevelopment = process.env.TOONFLOW_DEV_DESKTOP_WEB === "1";
const linuxDevDesktopWeb = desktopWebDevelopment && process.platform === "linux";
const devLanMode = process.env.TOONFLOW_DEV_LAN === "1";
if (devLanMode && !linuxDevDesktopWeb) throw new Error("TOONFLOW_DEV_LAN=1 仅支持 Linux 桌面桥接开发模式。");
const e2eMode = !!process.env.TOONFLOW_E2E_TEMP_DIRECTORY;
const webPort = Number(process.env.TOONFLOW_DEV_WEB_PORT || 5173);
const serverPort = Number(process.env.TOONFLOW_DEV_SERVER_PORT || 3000);
const linuxDevWorkspaceDirectory = linuxDevDesktopWeb
  ? process.env.TOONFLOW_DEV_WORKSPACE_DIR ?? resolve(import.meta.dirname, "../../data/workspaces/linuxDevWorkspace")
  : "";
const e2eWarmupFiles = [
  "./src/pages/workspace/index.vue",
  "./src/components/settings/index.vue",
  "./src/components/settings/panels/general/index.vue",
  "./src/components/settings/panels/general/nodeMenuSettings.vue",
  "./src/components/settings/panels/mediaModel/index.vue",
];

const privateNetworks = new BlockList();
privateNetworks.addSubnet("10.0.0.0", 8, "ipv4");
privateNetworks.addSubnet("172.16.0.0", 12, "ipv4");
privateNetworks.addSubnet("192.168.0.0", 16, "ipv4");
privateNetworks.addSubnet("fc00::", 7, "ipv6");

function normalizeAddress(address: string) {
  if (address.startsWith("::ffff:")) {
    const mappedAddress = address.slice(7);
    if (isIP(mappedAddress) === 4) return { address: mappedAddress, family: "ipv4" as const };
  }
  const family = isIP(address);
  if (family === 4) return { address, family: "ipv4" as const };
  if (family === 6) return { address, family: "ipv6" as const };
  return undefined;
}

function isLoopbackAddress(address: string) {
  return ["127.0.0.1", "::1"].includes(normalizeAddress(address)?.address ?? "");
}

function isTrustedLanAddress(address: string) {
  if (!devLanMode) return false;
  const remote = normalizeAddress(address);
  if (!remote || !privateNetworks.check(remote.address, remote.family)) return false;

  const activePrivateSubnets = new BlockList();
  for (const addresses of Object.values(networkInterfaces())) {
    for (const networkInterface of addresses ?? []) {
      const local = normalizeAddress(networkInterface.address);
      if (!local || local.family !== remote.family || !privateNetworks.check(local.address, local.family) || !networkInterface.cidr) continue;
      const [subnet, prefixLength] = networkInterface.cidr.split("/");
      if (subnet && prefixLength) activePrivateSubnets.addSubnet(subnet, Number(prefixLength), local.family);
    }
  }
  return activePrivateSubnets.check(remote.address, remote.family);
}

function setLanProxyHeaders(request: { setHeader(name: string, value: string): unknown }, incoming: { socket: { remoteAddress?: string } }) {
  if (!devLanMode) return;
  const address = incoming.socket.remoteAddress ?? "";
  request.setHeader("x-toonflow-local-client", isLoopbackAddress(address) ? "1" : "0");
  request.setHeader("x-toonflow-dev-lan-client", isTrustedLanAddress(address) ? "1" : "0");
}

function setApiProxyHeaders(request: { setHeader(name: string, value: string): unknown }, incoming: { socket: { remoteAddress?: string } }) {
  setLanProxyHeaders(request, incoming);
  if (!devLanMode) request.setHeader("x-toonflow-local-client", isLoopbackAddress(incoming.socket.remoteAddress ?? "") ? "1" : "0");
}

export default defineConfig({
  cacheDir: e2eMode ? resolve(process.env.TOONFLOW_E2E_TEMP_DIRECTORY!, "vite-cache") : undefined,
  css: { postcss: postcssConfig },
  define: {
    "import.meta.env.appVersion": JSON.stringify(desktopConfig.app.version),
    "import.meta.env.VITE_TOONFLOW_DEV_WORKSPACE_DIR": JSON.stringify(linuxDevWorkspaceDirectory),
  },
  server: {
    port: webPort,
    strictPort: process.env.TOONFLOW_DEV_STRICT_PORT === "1",
    warmup: e2eMode ? { clientFiles: e2eWarmupFiles } : undefined,
    open: desktopWebDevelopment && process.env.TOONFLOW_DEV_WEB_OPEN !== "0"
      ? `http://127.0.0.1:${webPort}/?desktop=1${linuxDevDesktopWeb ? "&linuxDevWorkspace=1" : ""}`
      : undefined,
    proxy: {
      "/mcp": {
        target: `http://127.0.0.1:${serverPort}`,
        changeOrigin: false,
        configure(proxy) { proxy.on("proxyReq", setLanProxyHeaders); },
      },
      "/a2a": {
        target: `http://127.0.0.1:${serverPort}`,
        changeOrigin: false,
        configure(proxy) { proxy.on("proxyReq", setLanProxyHeaders); },
      },
      "/api": {
        target: `http://127.0.0.1:${serverPort}`,
        changeOrigin: false,
        configure(proxy) { proxy.on("proxyReq", setApiProxyHeaders); },
      },
    },
  },
  optimizeDeps: e2eMode ? { entries: ["index.html", ...e2eWarmupFiles] } : undefined,
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      { find: /^shiki$/, replacement: fileURLToPath(new URL("./src/lib/shiki.ts", import.meta.url)) },
    ],
  },
  build: {
    outDir: "../../build/web",
    emptyOutDir: true,
  },
  plugins: [
    i18nPlugin(),
    vue(),
    components({
      globsExclude: ["src/components/settings/panels/**/*Dialog.vue"],
      dts: "src/types/components.d.ts",
      resolvers: [
        ElementPlusResolver(),
        (name) => {
          if (name.startsWith("Icon")) return { name, from: "@tabler/icons-vue" };
        },
      ],
    }),
  ],
});
