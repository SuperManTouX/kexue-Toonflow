import { expect, test, type Page } from "@playwright/test";
import { openLinuxDevWorkspace, resetSxwzStub } from "./e2eSupport";

test.beforeEach(async ({ request }) => {
  await resetSxwzStub(request);
});

async function openDocumentPanel(page: Page) {
  await page.locator(".panelSwitcher").getByText("文档", { exact: true }).click();
  await expect(page.getByRole("tree", { name: "工作区文件树" })).toBeVisible();
}

test("文档面板可新建 Markdown 文件并在重载后保留正文", async ({ page }) => {
  await openLinuxDevWorkspace(page);
  await openDocumentPanel(page);

  await page.getByRole("button", { name: "新建文件", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "新建文件" });
  await expect(createDialog).toBeVisible();
  await createDialog.getByRole("textbox").fill("e2e说明.md");
  await createDialog.getByRole("button", { name: "创建" }).click();
  await expect(createDialog).toBeHidden();

  const editor = page.getByRole("region", { name: "文档编辑" });
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "原文", exact: true }).click();
  const textarea = editor.getByRole("textbox", { name: "Markdown 原文" });
  const saved = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/workspaces/files/write" && response.request().method() === "PUT"
      && url.searchParams.get("path") === "e2e说明.md";
  });
  await textarea.fill("# E2E 文档\n\n文档正文保存测试。");
  expect((await saved).ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByRole("button", { name: "添加节点" })).toBeEnabled();
  await openDocumentPanel(page);
  await page.getByRole("textbox", { name: "搜索工作区文件与节点" }).fill("e2e说明.md");
  const entry = page.getByRole("treeitem", { name: "e2e说明.md" });
  await expect(entry).toBeVisible();
  await entry.dblclick();

  const reopenedEditor = page.getByRole("region", { name: "文档编辑" });
  await expect(reopenedEditor).toBeVisible();
  await reopenedEditor.getByRole("button", { name: "原文", exact: true }).click();
  await expect(reopenedEditor.getByRole("textbox", { name: "Markdown 原文" })).toHaveValue(/文档正文保存测试/);
});
