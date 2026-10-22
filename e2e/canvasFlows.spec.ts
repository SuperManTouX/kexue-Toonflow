import { expect, test, type Page } from "@playwright/test";
import { createFreshCanvas, openLinuxDevWorkspace, resetSxwzStub, switchCanvas, waitForCanvasSave } from "./e2eSupport";

function activeCanvas(page: Page) {
  return page.locator(".canvasRuntime:not(.backgroundCanvas)");
}

async function addTextNode(page: Page) {
  await page.getByRole("button", { name: "添加节点" }).click();
  await page.getByRole("menuitem", { name: "文本", exact: true }).click();
  const node = activeCanvas(page).locator(".vue-flow__node-remote-textNode");
  await expect(node).toBeVisible();
  return node;
}

test.beforeEach(async ({ request }) => {
  await resetSxwzStub(request);
});

test("文本节点正文编辑后保存并在重载后保留", async ({ page }) => {
  await openLinuxDevWorkspace(page);
  await createFreshCanvas(page, "E2E文本节点");
  const node = await addTextNode(page);

  await node.locator(".titleBar").click();
  await node.getByRole("button", { name: "编辑", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑文本" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "原文", exact: true }).click();

  const contentSaved = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/workspaces/files/write" && response.request().method() === "PUT"
      && /^assets\/[^/]+\/content\.md$/.test(url.searchParams.get("path") ?? "");
  });
  await dialog.getByRole("textbox", { name: "编辑文本内容" }).fill("# E2E 文本\n\n这是端到端测试正文。");
  expect((await contentSaved).ok()).toBeTruthy();
  await dialog.locator(".el-dialog__headerbtn").click();
  await expect(dialog).toBeHidden();
  await expect(node.locator('[aria-label="文本内容"]')).toContainText("E2E 文本");

  await page.reload();
  await expect(page.getByRole("button", { name: "添加节点" })).toBeEnabled();
  await switchCanvas(page, "E2E文本节点");
  const reloadedNode = activeCanvas(page).locator(".vue-flow__node-remote-textNode");
  await expect(reloadedNode).toBeVisible();
  await expect(reloadedNode.locator('[aria-label="文本内容"]')).toContainText("E2E 文本");
});

test("节点删除后可撤销和重做", async ({ page }) => {
  await openLinuxDevWorkspace(page);
  await createFreshCanvas(page, "E2E节点撤销");
  const node = await addTextNode(page);
  const nodes = activeCanvas(page).locator(".vue-flow__node-remote-textNode");

  await node.locator(".titleBar").click();
  await expect(nodes).toHaveClass(/selected/);
  const deletedSave = waitForCanvasSave(page, "E2E节点撤销");
  await page.keyboard.press("Backspace");
  await expect(nodes).toHaveCount(0);
  expect((await deletedSave).ok()).toBeTruthy();

  await page.keyboard.press("Control+z");
  await expect(nodes).toHaveCount(1);
  await page.keyboard.press("Control+Shift+z");
  await expect(nodes).toHaveCount(0);
  const restoredSave = waitForCanvasSave(page, "E2E节点撤销");
  await page.keyboard.press("Control+z");
  await expect(nodes).toHaveCount(1);
  expect((await restoredSave).ok()).toBeTruthy();
});

test("画布节点搜索可定位已添加节点", async ({ page }) => {
  await openLinuxDevWorkspace(page);
  await createFreshCanvas(page, "E2E节点搜索");
  const node = await addTextNode(page);
  const canvas = page.locator('.canvas[aria-hidden="false"]');
  const box = await canvas.boundingBox();
  if (!box) throw new Error("画布不可见");
  await canvas.click({ position: { x: box.width * 0.32, y: box.height * 0.72 } });

  await page.keyboard.press("Control+f");
  const dialog = page.getByRole("dialog", { name: "画布节点搜索" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "搜索画布节点" }).fill("文本");
  const option = dialog.getByRole("option", { name: /文本/ });
  await expect(option).toBeVisible();
  await option.click();
  await expect(dialog).toBeHidden();
  await expect(node).toHaveClass(/selected/);
});

test("新增画布并切回后各自节点状态保持独立", async ({ page }) => {
  await openLinuxDevWorkspace(page);
  await createFreshCanvas(page, "E2E画布甲");
  const firstSave = waitForCanvasSave(page, "E2E画布甲");
  await addTextNode(page);
  expect((await firstSave).ok()).toBeTruthy();

  await createFreshCanvas(page, "E2E画布乙");
  await expect(activeCanvas(page).locator(".vue-flow__node")).toHaveCount(0);

  await switchCanvas(page, "E2E画布甲");
  await expect(activeCanvas(page).locator(".vue-flow__node")).toHaveCount(1);
  await expect(activeCanvas(page).locator(".vue-flow__node-remote-textNode")).toBeVisible();
});
