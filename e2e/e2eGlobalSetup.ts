import { chromium, expect, type FullConfig } from "@playwright/test";

export default async function e2eGlobalSetup(config: FullConfig) {
  const { metadata } = config;
  const sxwzBaseUrl = metadata.sxwzBaseUrl;
  const dataDirectory = metadata.dataDirectory;
  const workspaceDirectory = metadata.workspaceDirectory;
  const temporaryDirectory = metadata.temporaryDirectory;
  if ([sxwzBaseUrl, dataDirectory, workspaceDirectory, temporaryDirectory].some(value => typeof value !== "string" || !value)) {
    throw new Error("Playwright E2E 临时运行配置缺失");
  }
  Object.assign(process.env, {
    TOONFLOW_E2E_SXWZ_URL: sxwzBaseUrl,
    TOONFLOW_E2E_DATA_DIRECTORY: dataDirectory,
    TOONFLOW_E2E_WORKSPACE_DIRECTORY: workspaceDirectory,
    TOONFLOW_E2E_TEMP_DIRECTORY: temporaryDirectory,
  });

  const webPort = config.metadata.webPort;
  if (typeof webPort !== "number") throw new Error("Playwright E2E Web 端口配置缺失");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "zh-CN" });
    const diagnostics: string[] = [];
    page.on("pageerror", error => diagnostics.push(`pageerror: ${error.message}`));
    page.on("console", message => {
      if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
    });
    page.on("response", async response => {
      if (new URL(response.url()).pathname !== "/api/workspaces/check") return;
      diagnostics.push(`workspace check ${response.status()}: ${await response.text().catch(() => "<empty>")}`);
    });
    const url = `http://127.0.0.1:${webPort}/?desktop=1&linuxDevWorkspace=1#/home`;
    let workspaceReady = false;
    for (let attempt = 0; attempt < 2 && !workspaceReady; attempt++) {
      await page.goto(url).catch(() => {});
      try {
        await expect(page).toHaveURL(/#\/workspace$/, { timeout: 10000 });
        await expect(page.getByRole("button", { name: "添加节点" })).toBeEnabled({ timeout: 10000 });
        workspaceReady = true;
      } catch (error) {
        if (attempt === 1) throw new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostics.join("\n")}`);
      }
    }
  } finally {
    await browser.close();
  }
}
