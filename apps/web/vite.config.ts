import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import desktopConfig from "../../electrobun.config.ts";
import postcssConfig from "../../postcss.config.ts";
import { i18nPlugin } from "@toonflow/i18n/vite";

const desktopWebDevelopment = process.env.TOONFLOW_DEV_DESKTOP_WEB === "1";
const linuxDevDesktopWeb = desktopWebDevelopment && process.platform === "linux";
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
      "/mcp": { target: `http://127.0.0.1:${serverPort}`, changeOrigin: false },
      "/a2a": { target: `http://127.0.0.1:${serverPort}`, changeOrigin: false },
      "/api": {
        target: `http://127.0.0.1:${serverPort}`,
        changeOrigin: false,
        configure(proxy) {
          proxy.on("proxyReq", (request, incoming) => {
            request.setHeader("x-toonflow-local-client", ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(incoming.socket.remoteAddress ?? "") ? "1" : "0");
          });
        },
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
