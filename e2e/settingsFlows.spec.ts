import { expect, test, type Page } from "@playwright/test";
import { openLinuxDevWorkspace, resetSxwzStub } from "./e2eSupport";

function settingsDialog(page: Page) {
  return page.getByRole("dialog", { name: "设置" });
}

async function openGeneralSettings(page: Page) {
  await page.locator(".workspaceMenu").getByRole("button", { name: /设置/ }).click();
  const settings = settingsDialog(page);
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "常规配置", exact: true }).click();
  await expect(settings.getByRole("region", { name: "节点菜单编辑器" })).toBeVisible();
  return settings;
}

test.beforeEach(async ({ request }) => {
  await resetSxwzStub(request);
});

test("常规配置可隐藏并恢复文本节点菜单", async ({ page }) => {
  await openLinuxDevWorkspace(page);
  try {
    const settings = await openGeneralSettings(page);
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/settings/save"
      && response.request().method() === "PUT");
    await settings.getByRole("button", { name: "隐藏文本", exact: true }).press("Enter");
    expect((await saved).ok()).toBeTruthy();

    await settings.locator(".el-dialog__headerbtn").click();
    await expect(settings).toBeHidden();
    await page.getByRole("button", { name: "添加节点" }).click();
    await expect(page.getByRole("menuitem", { name: "图片", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "文本", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");

    const reopened = await openGeneralSettings(page);
    const restored = page.waitForResponse(response => new URL(response.url()).pathname === "/api/settings/save"
      && response.request().method() === "PUT");
    await reopened.getByRole("button", { name: "显示文本", exact: true }).press("Enter");
    expect((await restored).ok()).toBeTruthy();
    await reopened.locator(".el-dialog__headerbtn").click();
    await expect(reopened).toBeHidden();

    await page.getByRole("button", { name: "添加节点" }).click();
    await expect(page.getByRole("menuitem", { name: "文本", exact: true })).toBeVisible();
  } finally {
    try {
      const settings = settingsDialog(page);
      if (!(await settings.isVisible())) await openGeneralSettings(page);
      else await settings.getByRole("button", { name: "常规配置", exact: true }).click();
      const showText = settings.getByRole("button", { name: "显示文本", exact: true });
      if (await showText.isVisible()) await showText.press("Enter");
      await settings.locator(".el-dialog__headerbtn").click();
    } catch {
      // 清理失败时保留用例本身的断言结果。
    }
  }
});
