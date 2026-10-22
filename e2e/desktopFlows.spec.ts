import { expect, test } from "@playwright/test";
import { openLinuxDevWorkspace, resetSxwzStub } from "./e2eSupport";

test.beforeEach(async ({ request }) => {
  await resetSxwzStub(request);
});

test("桌面首页只显示项目列表，连接状态接口返回成功", async ({ page }) => {
  const connectionStatuses: number[] = [];
  page.on("response", response => {
    if (new URL(response.url()).pathname === "/api/connection/connection") connectionStatuses.push(response.status());
  });

  await page.goto("/?desktop=1#/home");
  await expect(page.getByRole("heading", { name: "项目列表" })).toBeVisible();
  await expect(page.getByRole("button", { name: "添加项目" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect.poll(() => connectionStatuses).toContain(200);
  expect(connectionStatuses.every(status => status === 200)).toBeTruthy();
});

test("项目可从首页打开并返回项目列表", async ({ page }) => {
  await openLinuxDevWorkspace(page);
  await page.locator(".workspaceMenu").getByRole("button", { name: "退出项目" }).click();
  await page.getByRole("dialog", { name: "退出项目" }).getByRole("button", { name: "退出项目" }).click();

  const projectButton = page.getByRole("button", { name: "打开项目 linuxDevWorkspace" });
  await expect(projectButton).toBeVisible();
  await projectButton.click();
  await expect(page).toHaveURL(/#\/workspace$/);
  await expect(page.getByRole("button", { name: "添加节点" })).toBeEnabled();
});

test("画布节点自动保存并在重新打开后保留", async ({ page }) => {
  await openLinuxDevWorkspace(page);
  const activeCanvas = page.locator(".canvasRuntime:not(.backgroundCanvas)");
  await expect(activeCanvas.locator(".vue-flow__node")).toHaveCount(0);
  const saveResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/workspaces/files/write" && response.request().method() === "PUT"
      && url.searchParams.get("path") === "画布1.json";
  });
  await page.getByRole("button", { name: "添加节点" }).click();
  await page.getByRole("menuitem", { name: "文本", exact: true }).click();
  await expect(activeCanvas.locator(".vue-flow__node")).toHaveCount(1);
  expect((await saveResponse).ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByRole("button", { name: "添加节点" })).toBeEnabled();
  await expect(activeCanvas.locator(".vue-flow__node")).toHaveCount(1);
});
