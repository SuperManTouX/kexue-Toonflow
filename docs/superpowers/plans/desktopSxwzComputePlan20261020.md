# Toonflow 桌面端 SXWZ 算力接入实施计划

> **For agentic workers:** 使用 `superpowers:executing-plans` 按任务执行。仓库规范禁止新增测试模块；本计划以现有 typecheck、构建与静态/手动核对验证。

**Goal:** 让个人桌面端通过 SXWZ 账号登录，读取三个受支持平台的默认模型，并在现有 Agent 中调用文本模型；用户数据仍保存在本机。

**Architecture:** SXWZ 登录和算力请求都由本机 Server 代理。Server 只保存最小身份字段，并将 SXWZ token 加密存入本机数据目录；WebView 不接触 token。模型目录来自启用平台与三个受支持平台的交集，Agent 请求由 Server 根据已验证模型记录注入模型 UUID、平台和可信身份字段。

**Tech Stack:** Bun、TypeScript、Express、Zod、Vue 3、现有 `@earendil-works/pi-ai` OpenAI Completions 适配器、`@toonflow/file` 原子文件操作。

**Spec:** [docs/superpowers/specs/desktopSxwzComputeDesign20261020.md](../specs/desktopSxwzComputeDesign20261020.md)

## Global Constraints

- 桌面继续使用 `authMode: "local"`，SXWZ 登录状态与本机宿主身份分离。
- SXWZ 账号登录先获取图形验证码，使用 `appLogin` 提交账号、密码、`captchaId`、`captchaValue`，随后用 `Authorization: Bearer <token>` 调用 `validateToken`；不走自动注册，不保存密码或验证码，不更换 token。
- 算力目录只读取 `ai_chat`、`ai_coding`、`ai_painting_talk` 启用平台的默认模型；不查询课程模型。
- 首期只让 `kind` 为文本模型的记录进入 Agent；保留现有工具调用、流式输出、取消及本机历史。
- SXWZ token、用户/学校/session 身份只由 Server 管理，不能从 WebView 请求字段取得或返回给 WebView。
- 按仓库规范使用小驼峰文件、目录、变量、DOM 类名和自有组件名；路由每文件一个方法/路径并运行 `bun run routes`。
- 统一使用 `@toonflow/file` 与 `writeAtomic` 操作应用数据；不新增测试模块或测试依赖。

## Review Focus

- 登录成功但 `validateToken` 缺少用户 ID、sessionId 或 schoolId：必须拒绝建立算力会话。
- 非 1000 状态、异常 JSON、超时及登录失败：不能保存凭据或返回成功。
- 平台列表包含未知/关闭平台或目录字段格式错误：只使用支持集合内且校验通过的目录。
- 客户端伪造 model UUID、platform_code、user_id、school_id 或 sessionId：Server 必须从目录和已验证会话重建字段。
- 非文本模型、上游拒绝、流式失败或取消：不能误报成功、静默回退或自动重放请求。

## Tasks

### Task 1: 桌面 SXWZ 登录与本机凭据

**Files:**
- Create: `apps/server/src/utils/suanli/auth.ts`
- Create: `apps/server/src/routes/suanli/auth/login.ts`
- Create: `apps/server/src/routes/suanli/auth/get.ts`
- Create: `apps/server/src/routes/suanli/auth/logout.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/utils.ts`

**Interfaces:**
- Produces `getSuanliCaptcha(): Promise<SuanliCaptcha>`, `loginSuanli(username: string, password: string, captchaId: string, captchaValue: string)`, `getSuanliSession()`, `clearSuanliSession()` and `SuanliIdentity`.
- Captcha route returns `captchaImage` and `captchaId`; login route requires username/password/captchaId/captchaValue and responds with必要用户展示字段，不含 token。
- `get` route returns `{ user: null | { id, name } }`; `logout` removes the SXWZ credential only.

- [ ] 使用 Apifox 已发布定义调用 `/api/login/appLogin`，校验 `status` 和 `data.token`；再以 Bearer token 调用 `/api/login/validateToken`。
- [x] 只从 `userInfo` 白名单提取 `userId`、`sessionId`、`schoolId`、可选 `collegeId` 和展示名；忽略 `pwd`、`salt` 等字段。
- [x] 在本机 `data/auth/` 使用 0600 权限密钥和 AES-256-GCM + 原子写入保存 token/身份；缺失密钥但已有密文时拒绝重建；不把密码写盘。
- [x] 加入桌面本机来源校验、12 KB body 限制和有界登录尝试；无效上游响应不能覆盖现有会话。
- [x] 在应用路由加载前初始化凭据存储；新增三个分离路由并生成 `router.ts`。

### Task 2: SXWZ 默认模型目录与 Agent 请求适配

**Files:**
- Create: `apps/server/src/utils/suanli/client.ts`
- Create: `apps/server/src/utils/suanli/models.ts`
- Create: `apps/server/src/utils/suanli/types.ts`
- Create: `apps/server/src/routes/suanli/models.ts`
- Modify: `apps/server/src/utils.ts`
- Modify: `apps/server/package.json`
- Modify: `apps/server/src/utils/ai/index.ts`
- Modify: `apps/server/src/agent/runtime/model.ts`
- Modify: `apps/server/src/agent/runtime/requests.ts`

**Interfaces:**
- `listSuanliModels()` 返回带 `modelRef`、UUID `modelId`、`platformCode`、平台名、kind 和 label 的已校验记录。
- `getAgentConfiguredModel("suanli", modelRef)` 只允许当前登录目录内的文本模型。
- Agent 的 OpenAI-compatible payload 保留 `messages`、`tools`、`stream` 等字段，移除 `model`，由 Server 注入 `model_id`、`platform_code`、`client_task_id`、`sessionId`、`user_id`、`school_id` 及可用的 `college_id`。

- [x] 使用 `https://sxwz.xueai.art` 作为默认 API origin，支持仅用于部署/联调的 `SXWZ_BASE_URL` 覆盖；生产只接受 HTTPS。
- [x] 先读取启用平台，再与三项支持编码取交集，按可信身份请求默认模型；校验 code、平台回显、UUID 和必要文本字段。
- [x] 以 `platformCode:modelUuid` 作为 selector 引用，防止同 UUID 跨平台碰撞；课程模型与 `/suanli/v1/models` 字符串 ID 不进入 selector。
- [x] 为 Suanli 增加 OpenAI Completions runtime 配置；每次上游请求从已验证会话取得 Bearer 和身份，Server 重新解析 `modelRef` 并拒绝非文本模型。
- [x] 仅改写 Agent 发往 SXWZ 的 payload；复用现有 SSE、tool_calls、取消、错误处理和历史会话逻辑。

### Task 3: 桌面模型选择与账号表单

**Files:**
- Create: `apps/web/src/stores/suanli.ts`
- Create: `apps/web/src/components/suanliLoginDialog.vue`
- Modify: `apps/web/src/components/modelPopover.vue`
- Modify: `apps/web/src/components/agent/conversation.vue`
- Modify: `apps/web/src/components/singleAgentDialog.vue`

**Interfaces:**
- Store 公开登录状态、模型目录、刷新模型和账号状态读取；不保存 token。
- `agentModelChoices` 在桌面端合并本地供应商与已登录 SXWZ 文本模型，非桌面端保持现有选择行为。
- 登录弹窗打开时获取并显示图形验证码，允许刷新；将账号密码、captchaId 和 captchaValue 发给本机 Server，成功后清空凭据字段并刷新目录；提供本机 SXWZ 会话退出入口。

- [x] 在 Agent 模型选择器内增加算力账号登录状态与入口；未登录时不阻止现有本地供应商使用。
- [x] 显示 SXWZ 平台分组和文本模型，保留既有自定义模型选择；不展示绘画模型作为文本 Agent 模型。
- [x] 会话和单次 Agent 入口通过同一 `agentModelChoices` 解析选择，历史中 Suanli `providerId/modelId` 可继续恢复。
- [x] 处理目录加载错误、重复提交和会话切换；不将 token 放入 localStorage、Pinia 持久化或前端日志。

### Task 4: 路由生成、文档与静态验证

**Files:**
- Modify: `apps/server/src/router.ts`（仅由生成器改写）
- Modify: `docs/superpowers/specs/desktopSxwzComputeDesign20261020.md`

- [x] 在 `apps/server` 执行 `bun run routes`，核对新 URL、HTTP 方法及生成器输出。
- [x] `apps/server`、`apps/web` 的 `bun run build` 均通过；`bun run typecheck` 两端均受缺失的 `.hutch/devkit/api/config/ElectrobunConfig` 阻断，不能据此声称类型检查通过。
- [x] 静态核对日志与响应路径没有 token/password；检查用户、学校、模型字段均由 Server 注入。
- [ ] 真实 SXWZ 登录、模型获取、流式 tool_calls 联调需要用户账号及可访问上游；若当前没有运行时凭据，明确标记未验证。
- [x] 更新设计文档中的实施状态、token Bearer 假设、实际验证边界；不改造 Web 登录，不执行 Windows/RPM 打包。
