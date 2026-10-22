# Playwright E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Toonflow Linux 桌面桥接开发栈建立隔离、可重复的 Playwright E2E 套件，覆盖已确认的完整主链路。

**Architecture:** Playwright Test 在独立端口启动现有桌面开发栈和一个本地 SXWZ 协议替身。前端与本地 Server 走真实请求，外部登录、目录、模板、任务只由替身响应；每次运行使用临时数据目录和工作区，结束后清理。

**Tech Stack:** Bun workspaces、Node.js、TypeScript、`@playwright/test`、Chromium、现有 Toonflow Server/Web。

**Spec:** `docs/superpowers/specs/playwrightE2eDesign20261022.md`

## Global Constraints

- 默认不访问真实 SXWZ 账号或付费模型服务。
- 每次运行使用独立临时数据目录、工作区及 Web/Server/SXWZ 替身端口，不读取、覆盖或清理用户当前的 `data/` 设置及 `linuxDevWorkspace`，也不复用或停止开发者当前的服务。
- 应用仍经真实本地 Server 走登录、模型目录、模板读取和媒体生成请求；替身只在外部服务边界返回确定性响应。
- 用例串行运行，避免共享 Server 会话和本地测试数据相互竞争。
- 更新 `AGENTS.md` 的测试边界，只为本次批准的 Playwright E2E 套件增加明确例外；其他测试框架、单元测试和业务源码内的自检仍不增加。
- 新建文件和目录遵循仓库小驼峰命名；新增磁盘操作复用 `@toonflow/file`。

## Review Focus

- 开发者已有服务占用默认端口：E2E 使用独立端口并启用 strictPort，且不复用/停止现有进程；由 Task 1 验证默认开发端口保持原值。
- 会话凭证可能落盘或进入日志：所有认证只走 SXWZ 替身，检查测试日志不含测试 Token；由 Task 2 验证。
- 模型模板字段可能被单模型 schema 遗漏：替身提供参数类型不同的多个模型，断言返回字段是并集；由 Task 4 验证。
- 图片上传可能错误地提交本机路径或外部 URL：断言本地 Server 使用工作区相对路径读取文件，并向 SXWZ 发送 Base64；由 Task 4 验证。
- 超时/非法模板错误可能使 UI 重载或诊断缺字段：断言页面保持可用，日志含 modelRef 与校验路径且不含 hidden default；由 Task 4 验证。

---

### Task 1: 为桌面联调栈增加可配置隔离端口与目录

**Files:**
- Modify: `scripts/devStack.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/web/vite.config.ts`

**Interfaces:**
- Consumes: 可选环境变量 `TOONFLOW_DEV_WEB_PORT`、`TOONFLOW_DEV_SERVER_PORT`、`TOONFLOW_DEV_STRICT_PORT`、`TOONFLOW_DEV_WEB_OPEN`、`TOONFLOW_DEV_WORKSPACE_DIR`、`TOONFLOW_DATA_DIR`、`SXWZ_BASE_URL`。
- Produces: 未设置这些变量时行为保持原状；设置时 Web、Server、Linux 桌面工作区和数据目录按配置隔离。

- [x] 为 Server 监听端口、Vite 监听端口及 Vite `/api` 代理目标接入环境变量，分别保留 `3000` 和 `5173` 默认值；仅在 `TOONFLOW_DEV_STRICT_PORT=1` 时启用 strictPort。
- [x] 让 `scripts/devStack.ts desktop` 使用显式传入的工作区目录，未传时仍使用当前 Linux 默认目录；按服务分别传入 Web 与 Server 端口。
- [x] 允许 E2E 禁止 Vite 自动打开浏览器；默认开发行为保持不变。
- [x] 检查差异并验证端口/目录变量默认值与传入值；不启动或停止开发者当前运行的服务。

### Task 2: 接入 Playwright 并建立隔离服务替身

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `.gitignore`
- Modify: `AGENTS.md`
- Create: `playwrightConfig.ts`
- Create: `e2e/e2eGlobalSetup.ts`
- Create: `e2e/e2eGlobalTeardown.ts`
- Create: `e2e/sxwzStubServer.ts`

**Interfaces:**
- Consumes: Task 1 的可配置端口和目录变量。
- Produces: 根命令 `bun run e2e`；Chromium 单 worker 配置；config 为每轮执行创建临时数据根目录和工作区并分配独立端口，webServer 传入隔离 SXWZ 替身地址，teardown 清理临时数据；本地替身接受官方 SXWZ 登录/算力路由并提供内存请求记录接口。

- [x] 在根 workspace 添加 `@playwright/test` 与显式 `e2e` package script，更新锁文件。
- [x] 建立本地 SXWZ 替身：实现验证码、登录、Token 验证、平台模型列表、模型模板、任务创建/查询与失败响应；记录接收的模型与任务请求供断言读取。
- [x] 配置 Playwright 启停替身和 `bun run dev`，给各服务传独立端口、`TOONFLOW_DATA_DIR`、`TOONFLOW_DEV_WORKSPACE_DIR`、`SXWZ_BASE_URL`、strictPort 及禁止自动开浏览器标志；通过全局 setup 把本轮地址与临时目录传入 worker。
- [x] 设为 Chromium、串行 worker、失败 trace/截图和 HTML 报告；由 teardown 清理本轮临时目录。
- [x] 将 `playwright-report/`、`test-results/` 与临时运行数据加入忽略规则；在 `AGENTS.md` 明确仅此获批 E2E 套件可新增测试。
- [x] 运行 Playwright `--list` 并做一次最小启动导航，确认真实页面可打开且没有外部 SXWZ 请求。

### Task 3: 编写桌面首页、项目和画布 E2E 用例

**Files:**
- Create: `e2e/desktopFlows.spec.ts`
- Create: `e2e/e2eSupport.ts`

**Interfaces:**
- Consumes: Task 2 的隔离数据、SXWZ 替身和 Playwright config。
- Produces: 可复用的本地登录/打开测试项目助手，以及首页、项目往返、画布保存三个浏览器用例。

- [x] 实现 E2E 助手：使用 UI 和替身登录，只生成临时测试项目；不写浏览器存储来绕过登录/导航流程。
- [x] 编写桌面启动用例：断言首页保留项目列表、没有创作输入框；桌面连接状态接口必须返回 200。
- [x] 编写项目往返用例：打开工作区、退出到首页、从项目列表重新打开。
- [x] 编写画布保存用例：通过 UI 添加一个节点，等待保存后重载页面，再断言节点存在。
- [x] 运行 `bun run e2e --grep "桌面|项目|画布"`，修正选择器或启动问题直到这些场景通过。

### Task 4: 编写媒体模型、图片生成和错误诊断 E2E 用例

**Files:**
- Create: `e2e/mediaModelFlows.spec.ts`
- Create: `e2e/mediaGenerationFlows.spec.ts`
- Modify: `e2e/sxwzStubServer.ts`
- Modify: `e2e/e2eSupport.ts`

**Interfaces:**
- Consumes: Task 2 的替身请求记录和 Task 3 的测试项目/登录助手。
- Produces: 媒体模型与生成页面完整主链路和错误分支的浏览器用例。

- [x] 提供多模型 fixtures，跨模板覆盖参数类型、文生图、图片编辑、imageUpload 和条件字段；替身请求使用 `platform_code=toonflow`。
- [x] 编写媒体模型用例：经 UI 打开设置，断言无整页重载、供应商标题为“SXWZ算力”、模型列表/模板参数 schema 为多模型并集。
- [x] 编写图片生成用例：运行时生成合成 PNG，经 UI 上传；断言本地 Server 接收的是工作区相对图片路径，并由本地服务读取后向 SXWZ 替身提交 Base64 图片字段，任务返回图像后在画布显示。
- [x] 编写模板失败用例：替身依次返回无效模板和超时，断言错误提示、页面仍可操作，并从本轮隔离数据目录读取 JSONL 日志确认 modelRef/字段校验路径存在、凭证和完整 hidden default 不存在。
- [x] 运行全部 `bun run e2e`，8 个用例通过；临时数据目录由 teardown 清理。

### Task 5: 最终复核

**Files:**
- Review: 本计划涉及的所有变更文件。

- [x] 运行 `git diff --check`。
- [x] 运行 `bun run e2e` 并记录结果：8 passed，0 failed。
- [x] 复核 Playwright 配置使用本地 SXWZ 替身、隔离端口/目录和临时 TLS 证书；不触碰原有用户数据。
