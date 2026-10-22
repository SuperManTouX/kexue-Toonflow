import { expect, test } from "@playwright/test";
import { createFreshCanvas, loginSuanli, openLinuxDevWorkspace, resetSxwzStub } from "./e2eSupport";

test.beforeEach(async ({ request }) => {
  await resetSxwzStub(request);
});

test("媒体模型设置可以打开，不触发整页重载", async ({ page }) => {
  let pageLoads = 0;
  page.on("load", () => pageLoads++);
  await openLinuxDevWorkspace(page);

  await page.locator(".workspaceMenu").getByRole("button", { name: /设置/ }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  await settingsDialog.getByRole("button", { name: "媒体模型" }).click();
  await expect(settingsDialog.getByRole("heading", { name: "媒体模型" })).toBeVisible();
  await expect(settingsDialog.getByRole("button", { name: "添加供应商" })).toBeVisible();
  expect(pageLoads).toBe(1);
  expect(page.url()).toContain("#/workspace");
});

test("SXWZ 图片模型跨模板兼容参数 schema 并集", async ({ page }) => {
  await openLinuxDevWorkspace(page);
  await loginSuanli(page);
  await createFreshCanvas(page, "E2E模型模板");
  await page.getByRole("button", { name: "图片生成", exact: true }).click();

  const generatorNode = page.locator(".canvasRuntime:not(.backgroundCanvas) .vue-flow__node-remote-imageGenerationNode");
  const modelSelect = generatorNode.getByRole("combobox", { name: "生成模型" });
  await expect(modelSelect).toBeVisible();
  await modelSelect.click();
  await expect(page.locator(".el-select-group__title", { hasText: "SXWZ算力" })).toBeVisible();
  await page.getByRole("option", { name: "QwenImage2.0", exact: true }).click();

  await expect(generatorNode.getByText("提示词", { exact: true })).toBeVisible();
  await expect(generatorNode.getByText("步数", { exact: true })).toBeVisible();
  await expect(generatorNode.getByText("画面比例", { exact: true })).toBeVisible();
  await expect(generatorNode.getByText("生成数量", { exact: true })).toBeVisible();
  await expect(generatorNode.getByText("尺寸", { exact: true })).toBeVisible();
  const advancedField = generatorNode.locator(".el-form-item").filter({ hasText: "高级参数" });
  await expect(advancedField.locator(".el-switch")).toBeVisible();
  await expect(generatorNode.getByText("反向提示词", { exact: true })).toHaveCount(0);
  await expect(generatorNode.getByText("e2e-hidden-default-should-not-enter-diagnostics")).toHaveCount(0);

  await advancedField.locator(".el-switch").click();
  await expect(generatorNode.getByText("反向提示词", { exact: true })).toBeVisible();
  await expect(generatorNode.getByText("参考图比例", { exact: true })).toHaveCount(0);
  await expect(generatorNode.getByText("输出分辨率", { exact: true })).toHaveCount(0);

  await modelSelect.click();
  await page.getByRole("option", { name: "SchemaUnion-E2E", exact: true }).click();
  await advancedField.locator(".el-switch").click();
  await expect(generatorNode.getByText("参考图比例", { exact: true })).toBeVisible();
  await expect(generatorNode.getByText("输出分辨率", { exact: true })).toBeVisible();
  await expect(generatorNode.getByText("反向提示词", { exact: true })).toBeVisible();
});

test("媒体模型供应商详情可打开编辑弹窗", async ({ page }) => {
  await openLinuxDevWorkspace(page);
  await page.locator(".workspaceMenu").getByRole("button", { name: /设置/ }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("button", { name: "媒体模型" }).click();

  const provider = settings.locator(".providerItem").filter({ hasText: "TF-Router" });
  await expect(provider).toBeVisible();
  await expect(provider).toContainText("个模型");
  await provider.getByRole("button", { name: "编辑模型" }).click();

  const editor = page.getByRole("dialog", { name: "编辑媒体供应商：TF-Router" });
  await expect(editor).toBeVisible();
  await expect(editor.getByText("模型配置", { exact: false })).toBeVisible();
  await expect(editor.locator(".modelCard").first()).toBeVisible();
  await editor.getByRole("button", { name: "取消" }).click();
  await expect(editor).toBeHidden();
});
