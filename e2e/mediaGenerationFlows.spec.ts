import { Buffer } from "node:buffer";
import { join } from "node:path";
import { readFile } from "@toonflow/file";
import { expect, test, type Page } from "@playwright/test";
import { createFreshCanvas, getSxwzStubState, loginSuanli, openLinuxDevWorkspace, resetSxwzStub, setSxwzScenario } from "./e2eSupport";

const editModelId = "9e278645-43e1-4be2-bf06-e45ab689ba06";
const imageModelId = "54e8e5a7-a918-4a8b-a237-cbf1ef8f1061";
const invalidTemplateModelId = "d4c238f2-9661-4c82-95d7-5eb7ab4cc786";
const timeoutTemplateModelId = "abfc7a4b-f42d-4b22-85f8-a6fdb3ce81d5";
const testImage = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZp8AAAAASUVORK5CYII=", "base64");

test.beforeEach(async ({ request }) => {
  await resetSxwzStub(request);
});

async function addImageGenerationNode(page: Page) {
  await page.getByRole("button", { name: "图片生成", exact: true }).click();
  const node = page.locator(".canvasRuntime:not(.backgroundCanvas) .vue-flow__node-remote-imageGenerationNode");
  await expect(node).toBeVisible();
  await expect(node.getByRole("combobox", { name: "生成模型" })).toBeVisible();
  return node;
}

async function selectModel(page: Page, node: ReturnType<Page["locator"]>, modelName: string) {
  await node.getByRole("combobox", { name: "生成模型" }).click();
  await expect(page.getByRole("option", { name: modelName, exact: true })).toBeVisible();
  await page.getByRole("option", { name: modelName, exact: true }).click();
}

async function readSuanliLog() {
  const dataDirectory = process.env.TOONFLOW_E2E_DATA_DIRECTORY;
  if (!dataDirectory) throw new Error("缺少隔离的 E2E 数据目录");
  return String(await readFile(join(dataDirectory, "logs", "suanliRequests.jsonl"), "utf8"));
}

test("图片编辑主链路上传本地图片并以 Base64 提交到 SXWZ，生成图回到画布", async ({ page, request }) => {
  await openLinuxDevWorkspace(page);
  await loginSuanli(page);
  await createFreshCanvas(page, "E2E图片生成");
  const generatorNode = await addImageGenerationNode(page);

  const canvas = page.locator('.canvas[aria-hidden="false"]');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("画布不可见");
  await canvas.dblclick({ position: { x: canvasBox.width * 0.34, y: canvasBox.height * 0.76 } });
  await page.getByRole("menuitem", { name: "图片", exact: true }).click();
  const activeCanvas = page.locator(".canvasRuntime:not(.backgroundCanvas)");
  const imageNode = activeCanvas.locator(".vue-flow__node-remote-imageNode");
  await expect(imageNode).toBeVisible();

  await imageNode.locator('input[type="file"][aria-label="选择图片"]').setInputFiles({
    name: "e2e-reference.png",
    mimeType: "image/png",
    buffer: testImage,
  });
  await expect(imageNode.locator('img[alt="节点图片"]')).toBeVisible();

  const sourceHandle = imageNode.locator('[aria-label="图片输出 · IMAGE"]');
  const targetHandle = generatorNode.locator('[aria-label="图片、文本输入 · IMAGE / STRING"]');
  await sourceHandle.dragTo(targetHandle);
  await expect(activeCanvas.locator(".vue-flow__edge")).toHaveCount(1);
  await generatorNode.locator(".titleBar").click();

  const modelSelect = generatorNode.getByRole("combobox", { name: "生成模型" });
  await modelSelect.click();
  await expect(page.locator(".el-select-group__title", { hasText: "SXWZ算力" })).toBeVisible();
  await expect(page.getByRole("option", { name: "QwenImage2.0-Pro", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "QwenImage2.0-Pro", exact: true }).click();
  await expect(generatorNode.getByText("步数", { exact: true })).toBeVisible();
  await generatorNode.getByLabel("提示词").fill("E2E 合成图片编辑");

  const apiRequest = page.waitForRequest(item => {
    const url = new URL(item.url());
    return url.pathname === "/api/ai/media/generate" && item.method() === "POST";
  });
  const apiResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/ai/media/generate" && response.request().method() === "POST";
  });
  await generatorNode.getByRole("button", { name: "生成图片" }).click();
  const submittedRequest = await apiRequest;
  const requestBody = submittedRequest.postDataJSON() as { images?: { path: string; mimeType: string }[] };
  expect(requestBody.images).toHaveLength(1);
  expect(requestBody.images?.[0]?.path).toMatch(/^assets\//);
  expect(requestBody.images?.[0]?.mimeType).toBe("image/png");
  const response = await apiResponse;
  expect(response.ok()).toBeTruthy();
  const generatedImage = generatorNode.locator('img[alt="生成图片"]');
  await expect(generatedImage).toBeVisible({ timeout: 20000 });
  await expect.poll(() => generatedImage.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  const state = await getSxwzStubState(request);
  const taskRequest = state.requests.find(item => item.kind === "taskSubmit") as { body?: { model_id?: string; platform_code?: string; body?: Record<string, unknown> } } | undefined;
  expect(taskRequest?.body?.model_id).toBe(editModelId);
  expect(taskRequest?.body?.platform_code).toBe("toonflow");
  const uploaded = taskRequest?.body?.body?.imageUrls;
  expect(uploaded).toEqual([`data:image/png;base64,${testImage.toString("base64")}`]);
  expect(state.requests.some(item => item.kind === "taskPoll")).toBeTruthy();
});

test("文生图提交提示词并在画布显示生成结果", async ({ page, request }) => {
  await openLinuxDevWorkspace(page);
  await loginSuanli(page);
  await createFreshCanvas(page, "E2E文生图");
  const generatorNode = await addImageGenerationNode(page);
  await selectModel(page, generatorNode, "QwenImage2.0");
  await expect(generatorNode.getByLabel("提示词")).toBeVisible();
  await generatorNode.getByLabel("提示词").fill("E2E 文生图提示词");

  const apiResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/ai/media/generate" && response.request().method() === "POST";
  });
  await generatorNode.getByRole("button", { name: "生成图片" }).click();
  expect((await apiResponse).ok()).toBeTruthy();
  const generatedImage = generatorNode.locator('img[alt="生成图片"]');
  await expect(generatedImage).toBeVisible({ timeout: 20000 });
  await expect.poll(() => generatedImage.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  const state = await getSxwzStubState(request);
  const taskRequest = state.requests.find(item => item.kind === "taskSubmit") as { body?: { model_id?: string; body?: Record<string, unknown> } } | undefined;
  expect(taskRequest?.body?.model_id).toBe(imageModelId);
  expect(taskRequest?.body?.body?.prompt).toBe("E2E 文生图提示词");
});

test("任务失败时展示错误通知且页面保持可操作", async ({ page, request }) => {
  await openLinuxDevWorkspace(page);
  await loginSuanli(page);
  await createFreshCanvas(page, "E2E生成失败");
  const generatorNode = await addImageGenerationNode(page);
  await selectModel(page, generatorNode, "QwenImage2.0");
  await expect(generatorNode.getByLabel("提示词")).toBeVisible();
  await generatorNode.getByLabel("提示词").fill("E2E 失败提示词");
  await setSxwzScenario(request, { taskMode: "failed" });

  const apiResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/ai/media/generate" && response.request().method() === "POST";
  });
  await generatorNode.getByRole("button", { name: "生成图片" }).click();
  await apiResponse;

  const notification = page.locator(".el-notification").filter({ hasText: "图片生成失败" });
  await expect(notification).toBeVisible({ timeout: 20000 });
  await expect(notification).toContainText("E2E 模拟任务失败");
  await expect(generatorNode).toBeVisible();
  await expect(page.getByRole("button", { name: "添加节点" })).toBeEnabled();
  await expect(generatorNode.getByRole("button", { name: "生成图片" })).toBeEnabled();

  await page.locator(".workspaceMenu").getByRole("button", { name: /设置/ }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
});

test("无效模板显示字段诊断且页面保持可操作", async ({ page, request }) => {
  let pageLoads = 0;
  page.on("load", () => pageLoads++);
  await openLinuxDevWorkspace(page);
  await loginSuanli(page);
  await createFreshCanvas(page, "E2E无效模板");
  const generatorNode = await addImageGenerationNode(page);
  await setSxwzScenario(request, { templateMode: "invalid" });

  const modelRef = `ai_painting_talk:${invalidTemplateModelId}`;
  const templateResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/ai/media/template" && url.searchParams.get("modelRef") === modelRef;
  });
  await selectModel(page, generatorNode, "InvalidTemplate-E2E");
  expect((await templateResponse).status()).toBe(502);
  await expect(generatorNode.getByRole("alert")).toContainText("算力中台返回的模型参数模板格式或归属无效");
  await expect(page.getByRole("button", { name: "添加节点" })).toBeEnabled();

  const log = await readSuanliLog();
  const entries = log.trim().split("\n").map(line => JSON.parse(line) as { template?: { modelRef?: string; validationIssues?: { path: (string | number)[] }[] } });
  const failure = entries.find(entry => entry.template?.modelRef === modelRef);
  expect(failure?.template?.validationIssues?.some(issue => issue.path.join(".").includes("params"))).toBeTruthy();
  expect(log).not.toContain("e2e-token-only");
  expect(log).not.toContain("e2e-hidden-default-should-not-enter-diagnostics");
  await page.locator(".workspaceMenu").getByRole("button", { name: /设置/ }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  expect(pageLoads).toBe(1);
});

test("模板超时写入持久化诊断，节点错误后页面仍可操作", async ({ page, request }) => {
  let pageLoads = 0;
  page.on("load", () => pageLoads++);
  await openLinuxDevWorkspace(page);
  await loginSuanli(page);
  await createFreshCanvas(page, "E2E模板超时");
  const generatorNode = await addImageGenerationNode(page);
  await setSxwzScenario(request, { templateMode: "timeout" });

  const modelRef = `ai_painting_talk:${timeoutTemplateModelId}`;
  const templateResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/ai/media/template" && url.searchParams.get("modelRef") === modelRef;
  });
  await selectModel(page, generatorNode, "TimeoutTemplate-E2E");
  expect((await templateResponse).status()).toBe(504);
  await expect(generatorNode.getByRole("alert")).toContainText("算力中台请求超时", { timeout: 20000 });
  await expect(page.getByRole("button", { name: "添加节点" })).toBeEnabled();

  const log = await readSuanliLog();
  const entries = log.trim().split("\n").map(line => JSON.parse(line) as { path: string; phase: string; reason: string; status: number });
  expect(entries.some(entry => entry.path === `models/${timeoutTemplateModelId}/config` && entry.phase === "request" && entry.reason === "request_timeout" && entry.status === 504)).toBeTruthy();
  expect(log).not.toContain("e2e-token-only");
  await page.locator(".workspaceMenu").getByRole("button", { name: /设置/ }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  expect(pageLoads).toBe(1);
});
