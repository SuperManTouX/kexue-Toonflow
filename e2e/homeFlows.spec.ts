import { expect, test } from "@playwright/test";

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
