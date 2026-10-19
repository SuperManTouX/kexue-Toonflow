# Suanli Agent 接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Agent 对话中接入算力中台模型目录，让文本模型保留 Agent 工具调用，让非文本模型按 AIGC 模板提交任务并使用阿里云 OSS 上传参考图片。

**Architecture:** 服务端用 SXWZ 登录会话中的外部身份调用算力中台和独立 AIGC 域名，合并模型及模板后只向前端返回可展示的模型元数据。Agent 文本请求继续经过现有 pi-ai/OpenAI-compatible 工具循环，由服务端把模型 UUID 和可信身份写入算力请求；非文本请求由 Agent composer 的动态表单上传文件、创建任务并轮询结果。

**Tech Stack:** Bun、TypeScript、Express 5、Zod、Vue 3、现有 `@earendil-works/pi-ai` OpenAI Completions API、`@aws-sdk/client-s3`。

**Spec:** [docs/suanliAgentIntegrationDesign.md](../../suanliAgentIntegrationDesign.md)

## Global Constraints

- Agent 模型目录由算力中台提供，不写入或开放用户编辑 `customProviders`。
- `models[].id` 字符串只用作 AIGC 配置键；`courseModels[].id` UUID 用作算力聊天和任务接口的 `model_id`。
- 文本模型继续使用 Agent runtime 和标准 `tools` / 流式 `tool_calls`；非文本模型才显示模板表单。
- SXWZ 身份只在服务端上下文与上游请求中使用；不接受浏览器提交的 `user_id`、`school_id`、`sessionId`。
- `course_id` 当前没有可信来源，不发送也不接受。
- Server 使用 Bun、TypeScript、ES Modules、Express；输入使用 Zod，JSON 路由使用现有 `success` / `error` 响应格式。
- 新文件、目录、组件绑定和 DOM 类名使用小驼峰；一个路由文件只注册一个方法和路径，新增路由后运行 `bun run routes`。
- 遵守仓库测试边界：不新增测试、自检文件、测试依赖或测试脚本；只执行现有 typecheck、build 和必要的手动验证。
- OSS 凭证只从服务端环境读取；浏览器只能上传文件到 Toonflow，不直接访问 OSS 或算力/AIGC 上游。

## Review Focus

- SXWZ 响应缺少学校 ID、用户 ID 或 session ID 时，不能合成身份或发起需要学校权限的课程模型查询；由 Task 1 和 Task 2 的实际登录/模型目录请求核对。
- 同一模型名出现在多个平台时，必须保留各自课程模型 UUID 和平台编码；由 Task 2 的目录响应核对。
- AIGC 配置缺失、字段结构无效或出现未知 `ui` 时，不能提交不完整的非文本任务；由 Task 2、Task 4、Task 5 的模板与表单手动核对。
- 浏览器伪造身份、课程模型 UUID、任务 ID 或参考图片 URL 时，服务端必须按当前 SXWZ 身份重新解析模型并拒绝越权资源；由 Task 1、Task 2、Task 4 的请求边界核对。
- OSS 配置缺失、非图片类型、超限文件或上传失败时，不能泄漏凭证或继续创建任务；由 Task 4 和 Task 5 的上传链路核对。

---

### Task 1: 将 SXWZ 模型请求身份带入服务端用户上下文

**Files:**
- Modify: `apps/server/src/utils/auth/verify.ts`
- Modify: `apps/server/src/utils/auth/storage.ts`
- Modify: `apps/server/src/utils/auth/index.ts`
- Modify: `apps/server/src/utils/auth/middleware.ts`
- Modify: `apps/server/src/lib/userContext.ts`

**Interfaces:**
- Produces: `SuanliIdentity = { userId: string; sessionId: string; schoolId?: string }` in `@/lib/userContext`.
- Produces: `getCurrentUser().suanliIdentity`, present only for SXWZ sessions whose validation response contains a usable identity.
- Produces: `resolveSession()` returns the trusted identity with the session; public login/get responses continue returning only the existing safe `AuthUser` fields.

- [ ] **Step 1: Normalize and validate SXWZ claims.** Extend the existing validation schema for the external numeric-or-string user ID, `sessionId`, and optional school ID. Normalize IDs to strings; accept the documented nested school field when the top-level value is null; do not invent a school ID.
- [ ] **Step 2: Persist claims with the authenticated session.** Extend the session schema and `createStoredLogin` input with optional `SuanliIdentity`, preserving compatibility with existing `sessions.json` entries. Keep the existing 0600 auth storage and do not add identity fields to client-facing `AuthUser` responses.
- [ ] **Step 3: Populate request context from the resolved session.** Pass the session identity through `authRequest` into `createUserContext`; local mode and internal service credentials continue to omit it.
- [ ] **Step 4: Verify the server types.** Run `bun run --cwd apps/server typecheck`.

### Task 2: Fetch and merge the central model catalog and AIGC templates

**Files:**
- Create: `apps/server/src/utils/suanli/types.ts`
- Create: `apps/server/src/utils/suanli/client.ts`
- Create: `apps/server/src/utils/suanli/models.ts`
- Create: `apps/server/src/routes/suanli/models.ts`
- Create: `apps/server/src/routes/suanli/models/[courseModelId]/config.ts`
- Create: `apps/web/src/stores/suanli.ts`
- Modify: `apps/server/src/utils.ts`
- Modify: `apps/server/package.json`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/router.ts` via the route generator only

**Interfaces:**
- Produces: `SuanliParam = { ui: "textarea" | "proportion" | "hidden" | "dimension" | "quantity" | "resolution" | "select" | "imageUpload"; name: string; label: string; default?: unknown; required?: boolean; options?: (string | number)[]; maxCount?: number; dimension?: { width?: { min?: number; max?: number }; height?: { min?: number; max?: number }; separator: string } }`.
- Produces: `SuanliModel = { providerId: "suanli"; modelId: string; modelKey: string; label: string; kind: string; category?: string; platformCode: string; platformName: string; params?: SuanliParam[] }`; `modelId` is the course-model UUID and `modelKey` is `/suanli/v1/models[].id`.
- Produces: `GET /api/suanli/models` returns `{ code, data: SuanliModel[], message }` with every course-model record retained separately.
- Produces: `GET /api/suanli/models/:courseModelId/config` validates membership in the current user’s catalog and returns the refreshed AIGC `params` for that model’s `modelKey`.
- Produces: server exports the shared model response type through `@toonflow/server/suanli/types`; web store exports `suanliModels`, `refreshSuanliModels()`, and `getSuanliModel(value)` for the selector and Agent composer.

- [ ] **Step 1: Define server-only endpoint configuration and shared types.** Read `SUANLI_BASE_URL` as the base origin and append `/suanli/v1`; read `SUANLI_API_TOKEN`; use `AIGC_BASE_URL` with default `https://talkingdraw.xueai.art/aigc`. Validate URLs and return a clear configuration error without logging credentials.
- [ ] **Step 2: Implement bounded upstream requests.** In `client.ts`, add bearer-authenticated Suanli requests and AIGC requests with redirect rejection, abort timeouts, status checks, and JSON parsing. Do not forward browser authorization headers upstream.
- [ ] **Step 3: Assemble the model catalog.** Fetch `/models`; fetch `/platforms/course-models` with the trusted `schoolId` and `pageSize` capped at 100 until `total`; join `models[].id` to `courseModels[].name`; keep every course-model UUID/platform record; fetch the batch AIGC configs using string model IDs and attach `params` to the matching entries.
- [ ] **Step 4: Add the catalog and selected-model config routes.** Use `validateFields`, current-user identity, and existing response wrappers. The config route accepts a course-model UUID, resolves its string `modelKey` server-side, then calls AIGC `GET /open/models/{modelId}/config`.
- [ ] **Step 5: Add the web catalog store and export its response type.** The store reads only Toonflow’s catalog route, never the upstream domains; return no credentials or SXWZ identity fields to the browser.
- [ ] **Step 6: Generate and verify routes.** Run `bun run --cwd apps/server routes`, then `bun run --cwd apps/server typecheck`.

### Task 3: Route text models through Suanli while retaining Agent tools

**Files:**
- Modify: `apps/server/src/utils/ai/index.ts`
- Modify: `apps/server/src/agent/runtime/model.ts`
- Modify: `apps/server/src/agent/runtime/requests.ts`
- Modify: `apps/server/src/agent/runtime/sessions.ts`

**Interfaces:**
- Consumes: Task 1 `SuanliIdentity` and Task 2 `SuanliModel` / catalog lookup.
- Produces: `createAgentModel("suanli", courseModelId, thinkingLevel)` registers the selected catalog entry as an OpenAI Completions model using the configured Suanli base URL and server token.
- Produces: Agent request payload uses `model_id = courseModelId`, `platform_code` from the catalog, a server-generated `client_task_id`, and identity fields from `getCurrentUser().suanliIdentity`; existing `messages`, `tools`, and stream handling remain intact.

- [ ] **Step 1: Resolve Suanli models in the existing Agent model factory.** Add a `suanli` branch to configured-model lookup; reject a stale or unauthorized course-model UUID; retain existing generic providers for their non-Agent settings use.
- [ ] **Step 2: Register the OpenAI-compatible runtime model.** Register the selected UUID with `openai-completions`, the `/suanli/v1` base URL, and the server-side bearer credential; keep the runtime provider ID stable as `suanli` so session records remain resolvable.
- [ ] **Step 3: Translate only the request envelope.** In `configureAgentRequests`, use the existing `onPayload` hook to replace the OpenAI `model` field with Suanli `model_id` and inject `platform_code`, `client_task_id`, `sessionId`, `user_id`, and available `school_id`. Preserve `messages`, `tools`, stream options, and returned `tool_calls` unchanged.
- [ ] **Step 4: Resolve historical session context for Suanli models.** Update session context lookup so a stored `providerId: "suanli"` and course-model UUID use central model metadata instead of searching `settings.customProviders`.
- [ ] **Step 5: Verify the server types and build.** Run `bun run --cwd apps/server typecheck` and `bun run --cwd apps/server build`.

### Task 4: Add non-text task, polling, cancellation, and OSS upload routes

**Files:**
- Create: `apps/server/src/utils/suanli/oss.ts`
- Create: `apps/server/src/utils/suanli/tasks.ts`
- Create: `apps/server/src/routes/suanli/upload.ts`
- Create: `apps/server/src/routes/suanli/tasks.ts`
- Create: `apps/server/src/routes/suanli/tasks/[taskId].ts`
- Create: `apps/server/src/routes/suanli/tasks/[taskId]/cancel.ts`
- Modify: `apps/server/src/utils.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/router.ts` via the route generator only
- Modify: `apps/server/package.json` and `bun.lock`

**Interfaces:**
- Consumes: Task 1 identity and Task 2 catalog/template validation.
- Produces: `POST /api/suanli/upload` accepts one `application/octet-stream` image body and returns its public URL.
- Produces: `POST /api/suanli/tasks` accepts `{ modelId: string; body: Record<string, unknown> }`; the server resolves platform, creates `client_task_id`, injects identity, validates fields against `params`, and returns the upstream task ID/status.
- Produces: task status and queued-task cancellation routes proxy the corresponding `kexuetest` operations only after current-user identity/ownership validation.

- [ ] **Step 1: Add the S3-compatible OSS client.** Add `@aws-sdk/client-s3` to `apps/server`; configure endpoint, region, bucket, access key, secret, and public URL only from `OSS_ENDPOINT`, `OSS_REGION`, `OSS_BUCKET`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, and `OSS_PUBLIC_URL`. Use server-generated object keys under the internal user’s prefix.
- [ ] **Step 2: Add bounded raw image upload parsing.** Before global JSON parsing in `app.ts`, parse `application/octet-stream` for `/api/suanli/upload` with a 20 MB limit. Validate image content type and non-empty body; ignore client filenames when constructing object keys; return only the resulting public URL.
- [ ] **Step 3: Validate non-text task bodies on the server.** Re-resolve `modelId` in the current catalog; require a non-text model and valid template; apply template defaults; enforce required fields, allowed options, dimension bounds, `maxCount`, and ownership of uploaded OSS URLs; ignore identity/platform fields sent by the browser.
- [ ] **Step 4: Implement task creation, status, and cancellation proxies.** Inject trusted identity on supported upstream operations; bind status/cancel to the user who created the task; use the HTTP methods and payloads defined by the `kexuetest` Apifox operations; propagate upstream errors through the existing error middleware.
- [ ] **Step 5: Generate and verify routes and dependencies.** Run `bun run --cwd apps/server routes`, `bun run --cwd apps/server typecheck`, and `bun run --cwd apps/server build`.

### Task 5: Add the controlled model selector and non-text Agent form

**Files:**
- Create: `apps/web/src/components/agent/suanliTaskForm.vue`
- Modify: `apps/web/src/components/modelPopover.vue`
- Modify: `apps/web/src/components/agent/conversation.vue`
- Modify: `apps/web/src/stores/suanli.ts`
- Modify: `apps/web/src/stores/settings.ts` only to remove the Agent-only use of custom-provider `modelChoices`, if no other caller remains

**Interfaces:**
- Consumes: Task 2 `SuanliModel` store and server routes; Task 3 stable `providerId: "suanli"` plus course-model UUID; Task 4 upload/task routes.
- Produces: model selector options represent central course-model records and distinguish duplicate names by platform; no user `customProviders` model list appears in the Agent selector.
- Produces: text selections use existing Agent conversation requests; non-text selections render template fields and submit/poll tasks without invoking the text Agent route.

- [ ] **Step 1: Switch the Agent model selector to the central catalog.** Load `suanliModels` in `modelPopover.vue`, group by platform, preserve distinct UUIDs, and do not silently substitute a different model when the selected model disappears. Show reasoning controls only for text models.
- [ ] **Step 2: Load and render the selected model template.** When a non-text model is selected, refresh its `params` from `/api/suanli/models/:courseModelId/config`; if that request fails or returns an unsupported field, block submission with a visible error. In `suanliTaskForm.vue`, implement `textarea`, `proportion`, `hidden`, `dimension`, `quantity`, `resolution`, `select`, and `imageUpload`; initialize defaults and enforce required values, options, dimensions, and `maxCount`.
- [ ] **Step 3: Connect upload and task lifecycle.** Upload each selected image through Toonflow using `appFetch`, store the returned URL in the matching field, submit the selected course-model UUID and validated values, poll task status until a terminal result, and call the documented cancel operation when the user stops a queued task.
- [ ] **Step 4: Branch the existing composer by model kind.** Keep ordinary text input and `/api/agent` for text models so the Agent tool loop remains active; show the dynamic task form only for non-text models and render status/result in the current conversation view.
- [ ] **Step 5: Verify the web types and build.** Run `bun run --filter '@toonflow/web' typecheck` and `bun run --filter '@toonflow/web' build`.

### Task 6: Document deployment configuration and manually verify the integrated flow

**Files:**
- Modify: `docs/development.md`
- Modify: `docs/suanliAgentIntegrationDesign.md` only if implementation reveals a contract clarification that changes the approved behavior

- [ ] **Step 1: Document server environment variables.** Add names and required/default behavior for `SUANLI_BASE_URL`, `SUANLI_API_TOKEN`, `AIGC_BASE_URL`, and the six `OSS_*` variables; never add actual credentials.
- [ ] **Step 2: Run repository checks.** Run `bun run typecheck`, `bun run --cwd apps/server build`, and the web build after all route files have been generated.
- [ ] **Step 3: Manually verify with configured services.** In a signed-in SXWZ session, verify the merged catalog, a text conversation that emits an Agent tool call, a non-text form submission, an image upload, task polling, and queued cancellation. If deployment credentials or OSS configuration are unavailable, report those live calls as unverified rather than inferring success from compilation.

## Dependency Order

1. Task 1 establishes trusted identity.
2. Task 2 provides the user-scoped model catalog and template types.
3. Task 3 and Task 4 consume those contracts; Task 4 also adds the OSS dependency.
4. Task 5 consumes the finished server routes and provider behavior.
5. Task 6 documents configuration and runs final checks.

## Plan Self-Review

- Spec coverage: model merge and both AIGC config endpoints are in Task 2; Agent tool-preserving chat is in Task 3; dynamic forms, OSS, tasks, polling/cancellation are in Tasks 4–5; trusted identity and absent `course_id` are constrained across Tasks 1–4.
- Step scan: each task step is one implementation or verification action; server/frontend contracts are named at the task boundaries.
- Type consistency: Agent `providerId` is `"suanli"`; the selected `modelId` and task `modelId` are course-model UUIDs; `modelKey` is reserved for AIGC.
- Review focus: all five high-risk input classes map to concrete runtime validation and manual verification steps; no test files are planned because repository instructions prohibit them.
- Proportion: the plan follows the six coherent work phases and does not prescribe code bodies beyond the decisions needed to implement the approved spec.
