import { expect, type APIRequestContext, type Page } from "@playwright/test";

type SxwzStubState = {
  requests: { method: string; path: string; kind: string; body?: unknown }[];
};

export function getSxwzStubUrl() {
  const value = process.env.TOONFLOW_E2E_SXWZ_URL;
  if (!value) throw new Error("Playwright E2E 未配置 SXWZ 协议桩地址");
  return value;
}

export async function resetSxwzStub(request: APIRequestContext) {
  const response = await request.post(`${getSxwzStubUrl()}/__e2e/reset`);
  expect(response.ok()).toBeTruthy();
}

export async function setSxwzScenario(request: APIRequestContext, scenario: Record<string, unknown>) {
  const response = await request.post(`${getSxwzStubUrl()}/__e2e/scenario`, { data: scenario });
  expect(response.ok()).toBeTruthy();
}

export async function getSxwzStubState(request: APIRequestContext) {
  const response = await request.get(`${getSxwzStubUrl()}/__e2e/state`);
  expect(response.ok()).toBeTruthy();
  return await response.json() as SxwzStubState;
}

export async function loginSuanli(page: Page) {
  await page.getByRole("button", { name: "模型与推理设置" }).click();
  const account = page.locator(".agentModelPopover:visible .suanliAccount");
  const loginButton = account.getByRole("button", { name: "登录", exact: true });
  const accountName = account.getByText("E2E 用户", { exact: true }).first();
  await expect.poll(async () => await loginButton.isVisible() || await accountName.isVisible()).toBeTruthy();
  if (await loginButton.isVisible()) {
    await loginButton.click();
    const dialog = page.getByRole("dialog", { name: "登录 SXWZ 算力" });
    await expect(dialog.getByRole("img", { name: "图形验证码，点击刷新" })).toBeVisible();
    await dialog.getByLabel("账号").fill("e2e-user");
    await dialog.getByLabel("密码").fill("e2e-password");
    await dialog.getByRole("textbox", { name: "验证码" }).fill("e2e");
    await dialog.getByRole("button", { name: "登录", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "模型与推理设置" }).click();
  }
  await expect(page.getByRole("group", { name: "SXWZ 算力" }).getByText("E2E 用户", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "模型与推理设置" }).click();
}

export async function openLinuxDevWorkspace(page: Page) {
  await page.goto("/?desktop=1&linuxDevWorkspace=1#/home");
  const exitProjectButton = page.getByRole("button", { name: "退出项目" });
  const linuxProjectEntry = page.getByRole("button", { name: "打开项目 linuxDevWorkspace" });
  await expect.poll(async () => await exitProjectButton.isVisible() || await linuxProjectEntry.isEnabled(), { timeout: 30000 }).toBeTruthy();
  if (!await exitProjectButton.isVisible()) await linuxProjectEntry.click();
  await expect(exitProjectButton).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/#\/workspace(?:$|[?&])/);
  const addNodeButton = page.getByRole("button", { name: "添加节点" });
  await expect(addNodeButton).toBeEnabled({ timeout: 30000 });
}

export async function createFreshCanvas(page: Page, name: string) {
  await page.getByRole("button", { name: "切换画布" }).click();
  const picker = page.locator(".canvasPicker:visible").last();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "新增画布" }).click();
  const nameInput = page.getByRole("textbox", { name: "新画布名称" });
  await expect(nameInput).toBeVisible();
  await nameInput.fill(name);
  await nameInput.press("Enter");
  await expect(page.getByRole("button", { name: "切换画布" })).toContainText(name);
}

export async function switchCanvas(page: Page, name: string) {
  await page.getByRole("button", { name: "切换画布" }).click();
  const picker = page.locator(".canvasPicker:visible").last();
  await expect(picker).toBeVisible();
  await picker.getByText(name, { exact: true }).click();
  await expect(page.getByRole("button", { name: "切换画布" })).toContainText(name);
}

export function waitForCanvasSave(page: Page, name: string) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/workspaces/files/write" && response.request().method() === "PUT"
      && url.searchParams.get("path") === `${name}.json`;
  });
}
