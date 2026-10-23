import { expect, test } from "@playwright/test";
import { basename, isAbsolute } from "node:path";
import { openLinuxDevWorkspace } from "./e2eSupport";

test.beforeEach(async ({ page }) => {
  await page.goto("/?desktop=1#/home");
  await expect(page.getByRole("heading", { name: "项目列表" })).toBeVisible();
});

test("首页项目视图可切换并打开设置分类", async ({ page }) => {
  const items = page.locator(".projectItems");
  await expect(items).not.toHaveClass(/listView/);
  const listToggle = page.locator(".el-radio-button").filter({ has: page.getByRole("radio", { name: "列表视图" }) });
  await listToggle.click();
  await expect(items).toHaveClass(/listView/);
  const gridToggle = page.locator(".el-radio-button").filter({ has: page.getByRole("radio", { name: "网格视图" }) });
  await gridToggle.click();
  await expect(items).not.toHaveClass(/listView/);

  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "关于" }).click();
  await expect(settings.getByRole("heading", { name: "关于" })).toBeVisible();
  await expect(settings.getByRole("link", { name: "GitHub 仓库：HBAI-Ltd/Toonflow-app" })).toBeVisible();
  await settings.getByRole("button", { name: "隐私" }).click();
  await expect(settings.getByText("匿名使用统计", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
});

test("界面主题切换后刷新仍保留并可以恢复", async ({ page }) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("button", { name: "界面设置" }).click();

  const darkTheme = settings.locator(".el-radio").filter({ hasText: "深色" });
  const darkSaved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/settings/save"
    && response.request().method() === "PUT");
  await darkTheme.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect((await darkSaved).ok()).toBeTruthy();

  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await settings.getByRole("button", { name: "界面设置" }).click();
  const lightTheme = settings.locator(".el-radio").filter({ hasText: "浅色" });
  const lightSaved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/settings/save"
    && response.request().method() === "PUT");
  await lightTheme.click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  expect((await lightSaved).ok()).toBeTruthy();
});

test("项目可重命名并在刷新后保留", async ({ page }) => {
  const originalName = "linuxDevWorkspace";
  const renamed = "E2E项目重命名";
  await expect(page.getByRole("button", { name: `打开项目 ${originalName}` })).toBeVisible();
  try {
    await page.getByRole("button", { name: `重命名项目 ${originalName}` }).click();
    const dialog = page.getByRole("dialog", { name: "重命名项目" });
    await dialog.getByRole("textbox").fill(renamed);
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("button", { name: `打开项目 ${renamed}` })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: `打开项目 ${renamed}` })).toBeVisible();
  } finally {
    try {
      const renameButton = page.getByRole("button", { name: "重命名项目", exact: false }).first();
      if (await renameButton.isVisible()) {
        await renameButton.click();
        const dialog = page.getByRole("dialog", { name: "重命名项目" });
        await dialog.getByRole("textbox").fill(originalName);
        await dialog.getByRole("button", { name: "保存" }).click();
        await expect(page.getByRole("button", { name: `打开项目 ${originalName}` })).toBeVisible();
      }
    } catch {
      // 清理失败时保留原始断言结果，避免覆盖重命名用例本身的问题。
    }
  }
});

test("新建项目输入名称后自动创建并展示绝对路径", async ({ page }) => {
  await openLinuxDevWorkspace(page);
  await page.goto("/?desktop=1#/home");

  const projectName = "E2E自动创建项目";
  await page.getByRole("button", { name: "添加项目" }).click();
  const dialog = page.getByRole("dialog", { name: "新建项目" });
  await dialog.getByRole("textbox", { name: "项目名称" }).fill(projectName);
  const createResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/workspaces/create" && response.request().method() === "POST";
  });
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  const response = await createResponse;
  expect(response.ok()).toBeTruthy();
  const result = await response.json() as { data: { directory: string } };
  const directory = result.data.directory;
  expect(isAbsolute(directory)).toBeTruthy();
  expect(basename(directory)).toBe(projectName);
  await expect(page).toHaveURL(/#\/workspace$/);

  await page.goto("/?desktop=1#/home");
  const projectButton = page.getByRole("button", { name: "打开项目 " + projectName });
  await expect(projectButton).toBeVisible();
  const projectCard = page.locator(".projectCard").filter({ has: projectButton });
  await expect(projectCard.locator(".projectPath")).toHaveText(directory);

  const listingUrl = "/api/workspaces/files/list?directory=" + encodeURIComponent(directory);
  const listingResponse = await page.request.get(new URL(listingUrl, page.url()).toString(), { headers: { "x-toonflow-workspace": "1" } });
  expect(listingResponse.ok()).toBeTruthy();
  const listing = await listingResponse.json() as { data: { entries: { name: string }[] } };
  expect(listing.data.entries.map(entry => entry.name)).toContain("画布1.json");
});
