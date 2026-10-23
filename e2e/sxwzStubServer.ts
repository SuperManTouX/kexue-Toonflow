import { randomUUID } from "node:crypto";
import { readFile } from "@toonflow/file";

const host = "127.0.0.1";
const port = Number(process.env.TOONFLOW_E2E_SXWZ_PORT || 0);
const imageModelId = "54e8e5a7-a918-4a8b-a237-cbf1ef8f1061";
const editModelId = "9e278645-43e1-4be2-bf06-e45ab689ba06";
const schemaUnionModelId = "6a6d0ff6-35cb-4d91-9a28-48cd17f30f12";
const invalidTemplateModelId = "d4c238f2-9661-4c82-95d7-5eb7ab4cc786";
const timeoutTemplateModelId = "abfc7a4b-f42d-4b22-85f8-a6fdb3ce81d5";
const videoModelId = "1c9496b2-4514-433c-9557-a7ed0df4a5aa";
const audioModelId = "d90b34b0-1290-4d08-a1e2-75f6f8506d33";
const chatModelId = "cb6a1c9c-fc2d-4d36-86ea-f2bf47d2c534";
const hiddenDefault = "e2e-hidden-default-should-not-enter-diagnostics";
const captchaImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZp8AAAAASUVORK5CYII=";
const models = [
  { id: imageModelId, name: "QwenImage2.0", display_name: "QwenImage2.0", kind: "task", category: "image", tags: ["文生图"] },
  { id: editModelId, name: "QwenImage2.0-Pro", display_name: "QwenImage2.0-Pro", kind: "task", category: "image", tags: ["图片编辑"] },
  { id: schemaUnionModelId, name: "SchemaUnion-E2E", display_name: "SchemaUnion-E2E", kind: "task", category: "image", tags: ["文生图"] },
  { id: invalidTemplateModelId, name: "InvalidTemplate-E2E", display_name: "InvalidTemplate-E2E", kind: "task", category: "image", tags: ["文生图"] },
  { id: timeoutTemplateModelId, name: "TimeoutTemplate-E2E", display_name: "TimeoutTemplate-E2E", kind: "task", category: "image", tags: ["文生图"] },
  { id: videoModelId, name: "Video-E2E", display_name: "Video-E2E", kind: "task", category: "video", tags: ["文生视频", "图生视频"] },
  { id: audioModelId, name: "Audio-E2E", display_name: "Audio-E2E", kind: "task", category: "audio", tags: ["音乐生成"] },
  { id: chatModelId, name: "Chat-E2E", display_name: "Chat-E2E", kind: "llm", category: "llm", tags: ["聊天"] },
];

type StubRequest = { method: string; path: string; kind: string; body?: unknown };
type StubTask = { task_id: string; client_task_id: string; status: string; vendor_raw?: unknown; error?: unknown };
const requests: StubRequest[] = [];
const tasks = new Map<string, StubTask>();
let templateMode: "valid" | "invalid" | "timeout" = "valid";
let taskMode: "success" | "failed" = "success";
const certificatePath = process.env.TOONFLOW_E2E_TLS_CERT_PATH;
const privateKeyPath = process.env.TOONFLOW_E2E_TLS_KEY_PATH;
if (!certificatePath || !privateKeyPath) throw new Error("SXWZ E2E 结果桩缺少 TLS 证书");
const [certificate, privateKey] = await Promise.all([
  readFile(certificatePath, "utf8"),
  readFile(privateKeyPath, "utf8"),
]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function envelope(data: unknown) {
  return { status: 1000, message: "Success", data };
}

function taskEnvelope(data: unknown) {
  return { code: 0, data };
}

const resultServer = Bun.serve({
  hostname: host,
  port: 0,
  tls: { cert: String(certificate), key: String(privateKey) },
  fetch(request) {
    if (new URL(request.url).pathname === "/result.png" && request.method === "GET") {
      return new Response(Buffer.from(captchaImage, "base64"), { headers: { "Content-Type": "image/png" } });
    }
    return json({ message: "not found" }, 404);
  },
});

function imageTemplate(modelId: string, platformId: string, withUpload: boolean) {
  return {
    code: 0,
    data: {
      id: 1,
      modelId,
      platformId,
      inputType: withUpload ? "image" : "text",
      maxImages: withUpload ? 4 : 0,
      promptPlaceholder: "E2E 测试提示词",
      params: [
        { name: "prompt", label: "提示词", ui: "textarea", required: true, maxLength: 2000 },
        { name: "steps", label: "步数", ui: "number", default: 2, min: 1, max: 8 },
        { name: "ratio", label: "画面比例", ui: "select", default: "1:1", options: ["1:1", "16:9"] },
        { name: "count", label: "生成数量", ui: "quantity", default: 1, options: [1, 2] },
        { name: "dimension", label: "尺寸", ui: "dimension", default: "512x512", dimension: { width: { min: 256, max: 2048 }, height: { min: 256, max: 2048 }, separator: "x" } },
        { name: "advanced", label: "高级参数", ui: "switch", default: false },
        { name: "negativePrompt", label: "反向提示词", ui: "textarea", maxLength: 2000, showWhen: { advanced: true } },
        ...(modelId === schemaUnionModelId ? [
          { name: "referenceProportion", label: "参考图比例", ui: "proportion", default: "3:2", options: ["3:2", "1:1"], showWhen: { advanced: true } },
          { name: "outputResolution", label: "输出分辨率", ui: "resolution", default: "1K", options: ["1K", "2K"], showWhen: { advanced: true } },
        ] : []),
        { name: "seed", label: "种子", ui: "hidden", default: hiddenDefault },
        ...(withUpload ? [{ name: "imageUrls", label: "参考图片", ui: "imageUpload", required: true, default: [], maxCount: 4, maxSizeMB: 10 }] : []),
      ],
    },
  };
}

const server = Bun.serve({
  hostname: host,
  port,
  idleTimeout: 60,
  maxRequestBodySize: 110 * 1024 * 1024,
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/__e2e/health" && request.method === "GET") return json({ ready: true });
    if (path === "/__e2e/result.png" && request.method === "GET") {
      return new Response(Buffer.from(captchaImage, "base64"), { headers: { "Content-Type": "image/png" } });
    }
    if (path === "/__e2e/state" && request.method === "GET") return json({ requests, templateMode, taskMode });
    if (path === "/__e2e/reset" && request.method === "POST") {
      requests.length = 0;
      tasks.clear();
      templateMode = "valid";
      taskMode = "success";
      return json({ reset: true });
    }
    if (path === "/__e2e/scenario" && request.method === "POST") {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      if (["valid", "invalid", "timeout"].includes(String(body.templateMode))) templateMode = body.templateMode as typeof templateMode;
      if (["success", "failed"].includes(String(body.taskMode))) taskMode = body.taskMode as typeof taskMode;
      return json({ templateMode, taskMode });
    }

    if (path === "/api/captcha/generate" && request.method === "GET") {
      requests.push({ method: request.method, path, kind: "captcha" });
      return json(envelope({ captchaId: "e2e-captcha", captchaImage }));
    }
    if (path === "/api/login/appLogin" && request.method === "POST") {
      requests.push({ method: request.method, path, kind: "login" });
      return json(envelope({ token: "e2e-token-only" }));
    }
    if (path === "/api/login/validateToken" && request.method === "POST") {
      requests.push({ method: request.method, path, kind: "validateToken" });
      return json(envelope({ userInfo: { userId: 7001, nickname: "E2E 用户", sessionId: "e2e-session", schoolId: 8001, eduStudent: { collegeId: 9001 } } }));
    }
    if (path === "/suanli/v1/platforms/toonflow/models" && request.method === "GET") {
      requests.push({ method: request.method, path, kind: "platformModels" });
      return json({ code: 0, data: { platform: { code: "toonflow", name: "Toonflow" }, models } });
    }
    const configMatch = path.match(/^\/suanli\/v1\/models\/([^/]+)\/config$/);
    if (configMatch && request.method === "GET") {
      requests.push({ method: request.method, path, kind: "modelConfig", body: { modelId: configMatch[1] } });
      if (templateMode === "timeout" && configMatch[1] === timeoutTemplateModelId) {
        await Bun.sleep(30000);
      }
      if (templateMode === "invalid" && configMatch[1] === invalidTemplateModelId) return json({ code: 0, data: { id: 1, modelId: configMatch[1], platformId: "invalid-platform", inputType: "text", maxImages: 0, params: [{ name: "unsupported", label: "不支持的参数", ui: "futureWidget", default: hiddenDefault }] } });
      const model = models.find(item => item.id === configMatch[1]);
      if (!model) return json({ code: 404, message: "model not found", data: null }, 404);
      return json(imageTemplate(model.id, "ai_painting_talk", model.id === editModelId));
    }
    if (path === "/suanli/v1/tasks" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      requests.push({ method: request.method, path, kind: "taskSubmit", body });
      const input = body as { client_task_id?: string };
      const task: StubTask = {
        task_id: randomUUID(),
        client_task_id: input.client_task_id ?? "e2e-client-task",
        status: "queued",
      };
      tasks.set(task.task_id, task);
      return json(taskEnvelope({ task_id: task.task_id, client_task_id: task.client_task_id, status: "queued", position: 0 }));
    }
    const taskMatch = path.match(/^\/suanli\/v1\/tasks\/([^/]+)$/);
    if (taskMatch && request.method === "GET") {
      const task = tasks.get(taskMatch[1]);
      if (!task) return json({ code: 404, message: "task not found", data: null }, 404);
      task.status = taskMode === "failed" ? "failed" : "completed";
      if (taskMode === "failed") task.error = { message: "E2E 模拟任务失败" };
      else task.vendor_raw = { eventData: { results: [{ url: `https://${host}:${resultServer.port}/result.png`, outputType: "png" }] } };
      requests.push({ method: request.method, path, kind: "taskPoll" });
      return json(taskEnvelope(task));
    }
    if (taskMatch && path.endsWith("/cancel") && request.method === "POST") {
      const task = tasks.get(taskMatch[1]);
      return json(taskEnvelope({ task_id: taskMatch[1], cancelled: !!task }));
    }

    return json({ message: "not found" }, 404);
  },
});

console.log(`SXWZ E2E 协议桩已就绪：http://${host}:${server.port}`);
