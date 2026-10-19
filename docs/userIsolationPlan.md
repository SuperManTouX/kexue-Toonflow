# Web 用户隔离实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **执行状态：** Web 隔离实现已完成；多用户 Web 暂仅允许 FFmpeg 无参数探测，实际任务需要操作系统级沙箱后再开放。MCP/A2A Bearer 限定于协议入口，内部 API 调用使用绑定用户、目标和请求体的一次性签名。Web 不启动桌面设备互联进程。路由生成、Server/Web 构建及临时 HTTP 边界验证已执行；`apps/server` 和 `apps/web` 类型检查均被仓库现存缺失的 `.hutch/devkit/api/config/ElectrobunConfig` 导入阻断，所改共享包类型检查通过。真实 SXWZ 登录、真实双账号隔离和浏览器端到端验证尚未完成。计划中原生平台相关路径仅作方案阶段记录，不属于当前实现范围。

**Goal:** 接入 SXWZ 登录，使同一个 Web 服务中的用户只能访问自己的持久数据、任务和控制连接。

**Architecture:** 保持单进程 Express 服务，认证后以 AsyncLocalStorage 传递可信用户上下文。用户数据位于 `data/users/<userId>`，部署者提供的受信任资源位于新建的 `data/shared`。所有旧数据弃用，不迁移、不回退读取。

**Tech Stack:** Bun、TypeScript、Express、Zod、conf、Vue、Pinia、现有 Axios，以及 `@toonflow/file`。

**Spec:** [userIsolationDesign.md](./userIsolationDesign.md)。登录协议依据 `/home/mt/.codex/skills/sxwz-token-login/SKILL.md`。

## 全局约束

- 用户最新收窄范围：仅 Web 端及所需 server/共享协议修改；原生入口、原生数据布局、旧缓存行为保持不变，不执行原生专项构建。后文涉及其他平台的步骤以本条为准。

- 所有新文件、文件夹、自有组件绑定及标签使用小驼峰；Vue 顶层区块按 template、script、style 排列。
- 所有自有代码磁盘操作使用 `@toonflow/file`；完整快照使用原子写入，首次创建密钥使用 exclusive。
- 不新增测试、自检、mock、fixture、测试依赖或测试入口；下文验证均为已有编译命令或实际 HTTP 手动验证，不编写验证脚本。
- 不引入数据库、认证框架、账号密码、注册、管理后台或组织权限。
- 外部 Token 验证超时 10 秒，本地 Cookie 会话固定有效期 7 天，不新增 refresh 机制。
- 不记录 Token、Authorization、外部 sessionId、密钥、完整上游响应或用户内容；错误日志只保留脱敏类别及状态。
- 所有旧数据弃用；本次不执行现存磁盘文件的破坏性清理。新目录缺失时不得回退旧目录。
- 单进程模型；不启用 worker 或 cluster，不支持多个进程并发写同一数据目录。

## 审查重点

1. SXWZ HTTP 200 但业务失败、字段类型错误、非 JSON 或超时：均不得创建会话，对应任务 1、2。
2. 同一外部身份并发首次登录与服务重启：应复用同一本地用户，身份密钥不得被重建覆盖，对应任务 1。
3. Cookie 在另一标签页换号：旧标签页的自动保存、在途响应和 SSE 重连不得进入新用户上下文，对应任务 2、7。
4. 路径穿越、符号链接、他人绝对路径和有效但属于他人的任务 ID：均须拒绝，对应任务 3、5、6。
5. 经本机或反向代理访问、用户可提交的供应商源码和插件包：均不能绕过用户认证与宿主执行边界，对应任务 2、4。

上述涉及真实登录身份的验证必须使用真实的独立账号；缺少可用凭证时明确标记未验证，不用模拟身份代替。

---

### 任务 1：SXWZ 验证、身份映射和会话存储

**文件：** 新增 `apps/server/src/utils/auth/verify.ts`、`storage.ts`、`index.ts`；修改 `apps/server/src/utils.ts`。

**接口：**

- `type AuthMode = "local" | "sxwz"`；`type AuthUser = { id: string; name: string }`。
- `verifyExternalToken(token: string): Promise<{ userName: string; externalSubject: string }>` 只在内部返回外部身份。
- `initializeAuth(options: { dataDirectory: string; mode: AuthMode }): Promise<void>`。
- `createLogin(token: string): Promise<{ user: AuthUser; sessionToken: string; expiresAt: number }>`。
- `resolveSession(token: string): Promise<{ user: AuthUser; sessionHash: string; expiresAt: number } | undefined>`；`revokeSession(sessionHash: string): Promise<void>`。
- `getAuthMode(): AuthMode`，由启动配置决定，客户端不能切换。

- [x] 使用现有 Zod 严格校验 skill 给定响应，完整验证地址仅来自 `EXTERNAL_TOKEN_VERIFICATION_URL`，不追加路径、不跟随重定向；生产拒绝非 HTTPS。
- [x] 建立 `auth/identityKey`、`identities.json`、`sessions.json`。密钥随机生成并 exclusive 创建；HMAC 摘要映射外部身份，随机 UUID 作为本地用户 ID，随机 32 字节生成会话凭证。
- [x] 在 auth 模块集中串行处理读改写，原子保存成功后才返回可签发凭证；磁盘写入失败不得建立客户端登录。过期会话在读取和写入时清理。
- [x] 已执行 `bun run typecheck`；命令被仓库现存缺失的 `.hutch/devkit/api/config/ElectrobunConfig` 导入阻断，没有其他诊断。
- [ ] 获得真实凭证后手动核对首次/重复/并发登录和重启保持身份；真实上游异常分支无法安全重现时留作软测项。

### 任务 2：认证路由、用户上下文与统一授权

**文件：** 新增 `apps/server/src/lib/userContext.ts`、`apps/server/src/utils/auth/middleware.ts`、`apps/server/src/routes/auth/login.ts`、`get.ts`、`logout.ts`；修改 `app.ts`、`index.ts`、`utils.ts`。`router.ts` 由命令生成。桌面与移动端入口不修改。

**接口：**

- `type UserContext = { userId: string; name: string; dataDirectory: string; sessionHash?: string }`。
- `runWithUser<T>(user: UserContext, operation: () => T): T`；`getCurrentUser(): UserContext`。
- `createApp` 增加 `authMode: AuthMode`，独立服务显式传 `sxwz`；原生宿主沿用默认 `local` 模式。
- `POST /api/auth/login` 接收 `{ sxwzToken }`；`GET /api/auth/get` 返回 `{ user, mode }`；`POST /api/auth/logout` 撤销当前 Cookie 会话。

- [x] 在解析大型请求体和装配业务路由前建立认证边界；只有静态前端、auth/login、auth/get 可匿名访问。现有 languageRequest 保留，认证错误沿用统一响应结构。
- [x] login 使用每个网络来源最多 20 次/分钟的进程内限制，清理过期记录；同时设置全局在途上游验证上限 20，达到上限返回 429。不信任客户端伪造的转发地址。
- [x] Cookie 名为 `toonflowSession`，固定 7 天、HttpOnly、SameSite=Lax、Path=/，生产 Secure；写请求校验同源 Origin/Referer。按部署配置明确可信代理范围，不能为识别 HTTPS 无条件信任转发头。
- [x] 业务请求将 `x-toonflow-user` 与会话用户比较；仅用于拒绝旧页面请求，不用其选择用户。原生本地模式保持原来的数据目录、旧设置及缓存行为；此项不属于 Web 隔离范围。
- [x] 将路径边界和宿主能力判定切换为服务端模式判断；本机来源和自定义页面请求头不能跳过 Web 认证。服务器模式去掉开放凭证 CORS。
- [x] 已执行 `bun run routes` 和 `bun run typecheck`；类型检查仅被上述现存缺失导入阻断。临时数据目录 HTTP 验证确认匿名业务请求 401、空 Token 400、跨站登录拒绝及公开登录状态路由可用。
- [ ] 使用真实账号核对 Cookie 登录、退出和标签页身份不一致时旧页面请求被拒绝。

### 任务 3：用户配置和文件路径隔离

**文件：** 修改 `utils/conf/index.ts`、`utils.ts`、`utils/workspace/index.ts`、`utils/workspace/files.ts`、`utils/assets/index.ts`、`utils/personalization.ts`、`utils/skills/files.ts`、`utils/ai/files.ts`、`utils/singleAgent/index.ts`、`agent/skills/index.ts`、`agent/tools/index.ts`、`routes/workspaces/list.ts`、`routes/skills/get.ts`；同步全部配置调用方。

**接口：**

- 在 `utils/conf` 导出 `getConfig()`，返回当前用户的缓存配置实例；`u.conf` 使用 getter 调用它，不使用全局可变当前配置或 Proxy。
- `getUserDataDirectory(): string` 返回当前用户根目录；`getSharedDataDirectory(): string` 返回服务根目录下的 `shared`。两者均从启动配置推导，不接受请求中的路径。
- 原有 `resolveWorkspace(req, path)`、工作区文件 API、`useWorkspaceFiles` 协议保持不变。

- [x] 将 conf 初始化集中在原模块，按用户缓存实例，权限保持 0600；读取时缺少上下文直接报错。所有 import、`u.conf` 及 `.onDidChange` 调用方逐一核对，不让模块顶层初始化持有某个用户配置。
- [x] 工作区只允许当前用户 `workspaces` 目录内的 realpath；保留现有文件原子写入、冲突锁、目录保护和符号链接规则，不把用户根目录当工作区。
- [x] 素材、记忆、全局个性化文档、用户技能、AI 文件缓存和临时对话写入用户根目录；异步多步操作捕获初始用户和目录。
- [x] 删除旧设置清理/迁移的启动分支及全部旧路径回退；新用户仅使用当前版本的无密钥默认设置。
- [x] 已执行 server 类型检查；命令仅被上述现存缺失导入阻断。
- [ ] 使用两个真实用户手动核对独立设置、素材和目录枚举，以及他人绝对路径、`..`、符号链接越界拒绝。仅列出验证状态，不输出用户文件内容。

### 任务 4：共享资源与宿主执行边界

**文件：** 修改 `app.ts`、`utils/plugins/{tools,nodes,ext,install}.ts`、`utils/teams/{index,files,install}.ts`、`utils/media/{provider,debug}.ts`、`utils/ai/initialize.ts`、`utils/ffmpeg/index.ts`、`utils/auth/middleware.ts`，以及 `routes/nodes/{files,setEnabled}.ts`、`routes/{tools,ext,agents}/setEnabled.ts`。

**接口：**

- `canManageHost(): boolean` 仅由服务端模式决定；Web 用户永远不能管理宿主可执行代码。
- `getConfig()` 增加用户数据字段 `disabledTools`、`disabledNodes`、`disabledExt`、`disabledAgents` 与 `mediaProviderModels`；这些字段不是角色权限。
- 共享源码读取沿用现有公开函数签名；启用状态和模型列表通过当前用户配置叠加。

- [x] 共享资源只初始化到 `data/shared`；首次运行不扫描 `data/tools` 等旧目录。部署者提供的技能作为用户技能模板，不从旧数据导入。
- [x] 取消模块加载时根据用户 conf.path 固定插件目录的写法；共享资源目录通过明确的共享根入口获取。
- [x] 用户启用状态和模型列表写入自己的配置，不写共享 `.disabled` 文件或改共享供应商源码。模型初始化 Promise 以用户为键，避免只刷新首个用户。
- [x] 在统一服务端授权入口明确阻断 Web 模式的源码安装/调试运行/替换/删除、宿主更新、设备互联管理、本机文件读取和选择；工具调用与 HTTP 路由同时核对，不能只隐藏 UI。
- [x] Web 模式 FFmpeg 仅允许无参数探测，拒绝实际执行；部署程序使用可信共享文件，原生模式的既有安装行为改用新布局。
- [x] 已执行 server 类型检查；命令仅被上述现存缺失导入阻断。未登录 HTTP 请求访问业务路径（含供应商调试路径）返回 401。
- [ ] 使用登录用户验证宿主管理入口拒绝行为，并用真实 A/B 用户核对启用状态和模型列表互不影响。

### 任务 5：运行中的任务、回调和事件归属

**文件：** 修改 `utils/singleAgent/index.ts`、`agent/runtime/{index,sessions,delegation}.ts`、`agent/bridge/{question,canvas}.ts`、`utils/mcp/control.ts`、`utils/media/{billing,priceReference}.ts`、`utils/ai/{initialize,files}.ts`、`utils/assets/index.ts`、`utils/browser/index.ts`，以及 `routes/browser/{input,stream}.ts`。

**接口：** 原有业务方法签名优先保持；记录创建时增加 `userId` 和必要的 `sessionHash`，操作时从任务 2 的可信上下文检查归属。

- [x] 为只按 ID 查找的会话、回调、控制连接和订阅增加归属检查；不匹配时返回不存在或 403，拒绝操作前不得改变其状态。
- [x] 绝对路径索引仍复用现有实现，调用前完成用户工作区校验；定时器、子 Agent 和委派继续运行在创建者上下文。
- [x] 余额、报价、初始化和失效控制器按用户划分；资产游标继续核对当前用户根目录，不能仅凭游标 ID 翻页。
- [x] 为会话注册活跃流的关闭回调，退出/撤销该本地会话时关闭其订阅并释放回调，不能关闭其他用户或独立服务凭证的连接。
- [x] 已执行 server 类型检查；命令仅被上述现存缺失导入阻断。
- [ ] 在不触发实际计费任务的前提下，用真实 A/B 用户手动核对临时会话及控制连接的跨用户读取/控制/订阅拒绝。

### 任务 6：MCP 与 A2A 的用户绑定

**文件：** 修改 `apps/server/src/utils/auth/{storage,index,middleware}.ts`、`utils/mcp/{control,tools,runtime}.ts`、`agent/a2a/{index,settings}.ts`、`routes/settings/save.ts`、`routes/agents/a2a/save.ts`、`app.ts`、`index.ts`，以及 `packages/mcp/src/index.ts`。未重复前缀的服务端路径均相对 `apps/server/src`。

**接口：**

- `type ServiceKind = "mcp" | "a2a"`。
- `registerServiceCredential(userId: string, kind: ServiceKind, token?: string): Promise<void>` 将凭证摘要登记为唯一用户绑定；`undefined` 撤销。
- `resolveServiceCredential(kind: ServiceKind, token: string): Promise<AuthUser | undefined>` 解析绑定后仍检查该用户当前配置的启用状态与凭证摘要。
- `createMcpRouter` 的宿主选项增加 `getSessionScope?(request: Request): string`，包内 transport 会话以 scope 与协议 session ID 共同索引；包自身不依赖应用认证模块。

- [x] 凭证摘要在 auth 存储登记，重复绑定其他用户时拒绝；设置提交前先预留，配置成功才使新凭证生效。配置写失败时新凭证不得认证成功，重试可恢复预留。
- [x] `/mcp`、`/a2a` 从受验证的专属服务凭证建立用户上下文，外部传入的 userId、directory 和 connectionId 不能决定身份。
- [x] MCP 列表、内部 API 调用、A2A endpoint 缓存和配置变化控制器均按用户划分。MCP/A2A Bearer 仅认证各自协议入口；内部 API 调用使用服务端签发的短时、绑定用户/目标/请求体且不可重放的签名，禁止无鉴权 loopback 降级。
- [x] MCP transport 会话也检查用户 scope，不能因另一用户持有有效服务凭证，就允许复用他人的 `mcp-session-id`；初始化与后续工具回调始终绑定创建者。
- [x] Web 模式不启动每个用户独立的 MCP 监听端口或桌面设备互联服务；端口配置隐藏。原生模式继续复用本机运行时。
- [x] 已执行 server 类型检查；命令仅被上述现存缺失导入阻断。
- [ ] 真实凭证可用时验证 A 的服务凭证无法操作 B 工作区/控制连接，凭证关闭或轮换立即失效，网页退出不意外撤销独立服务凭证。

### 任务 7：前端登录初始化、请求和退出

**文件：** 新增 `apps/web/src/lib/auth.ts`、`apps/web/src/components/authGate.vue`；修改该目录下 `main.ts`、`App.vue`、`router/index.ts`、`stores/{settings,workspace,hello,developer}.ts`、`lib/{workspaceFiles,mcpControl,providerBilling}.ts`、`components/agent/conversation.vue`、`components/singleAgentDialog.vue`、`pages/workspace/components/workspaceMenu.vue`、`pages/home/index.vue`。

**接口：**

- `initializeAuth(): Promise<{ user: { id: string; name: string } | null; mode: "local" | "sxwz" }>`。
- `getRequestHeaders(): Record<string, string>` 绑定页面初始用户；`appFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>` 仅对同源业务请求增加一致性标记与会话失效处理。
- `logout(): Promise<void>` 先冻结当前页面保存/请求，再撤销 Cookie 并重新初始化。

- [x] 独立 `/token-login` 路由优先读取 Vue Router query 中的 `externaltoken`（兼容该路由的页面外层 query）；其他页面的 Token 参数不触发登录。调用 history.replaceState 清除参数，提交登录后再加载 settings 和 Pinia。上游失败不得挂载项目页面。
- [x] 无会话显示最小的 SXWZ 进入提示或实际错误；复用现有布局，不新增密码/注册表单或模拟内容。
- [x] 为默认 Axios、工作区 Axios 实例及同源 fetch 接入绑定用户标记；直接 EventSource 和资源 URL 无自定义头时，仅传非秘密的绑定用户 ID 供一致性检查，服务端仍依 Cookie 校验身份。
- [x] 删除旧 localStorage 导入、旧引导状态恢复和旧账号缓存分支；持久化只来自当前用户设置。保存队列、用户切换、401 和会话不一致统一停止写入并销毁当前页面状态。
- [x] 更新所有流式请求调用方，包括 Agent、临时 Agent、MCP 控制、余额订阅和图片/视频下载；同源 Cookie 认证，取消传播保留。
- [x] 已执行 web 类型检查；命令仅被上述现存缺失导入阻断，Web 构建通过。
- [ ] 两个真实账号的浏览器标签页手动验证先登录后加载设置、退出、切换账号及旧标签页自动保存拒绝，核对旧设置不会被导入。

### 任务 8：插件宿主请求和能力界面

**文件：** 新增 `packages/nodeScaffold/src/hostRequest.ts`；修改该包 `src/{runtime,nodeAi,nodeFfmpeg}.ts` 与 `package.json` exports，公开 `./hostRequest` 子路径；修改 `packages/ffmpeg/src/browser.ts`。修改 `apps/web/src/lib/auth.ts`、`components/settings/panels/{mediaModel,pluginMarket,developer,mcp}/index.vue`、`components/settings/panels/pluginMarket/ffmpeg.vue`、`components/settings/panels/deviceLink.vue` 及相关操作组件，未重复前缀的 Web 路径均相对 `apps/web/src`。

**接口：** `setHostRequest(request: typeof fetch): void`、`hostRequest: typeof fetch`。通过宿主注册同源请求函数；脚手架只提供通用宿主接口，不包含 SXWZ 或用户业务逻辑，也不覆盖全局 fetch。

`createBrowserFfmpeg(directory: string, signal?: AbortSignal, request?: typeof fetch): Promise<BrowserFfmpegFactory>` 增加可选宿主请求参数；节点传入 `hostRequest`，其他调用方默认行为保持一致。准备、执行和显式取消均使用同一个请求实例。

- [x] 独立 UMD 通过共享宿主请求桥接节点 AI 与 FFmpeg 探测请求；Web 多用户模式不执行 FFmpeg 任务，服务端模型调用继续由后端会话授权；禁止把身份或凭证交给模型参数。
- [x] Web 设置页面按服务端模式隐藏源码安装、修改、卸载、调试、宿主更新和设备互联管理操作；保留用户 API Key、模型列表、启用状态和业务配置操作。
- [x] 节点、工具、扩展与 Web 宿主的所有实际请求入口均携带一致性标记；共享模型/价格缓存随用户页面重建失效。
- [x] 所改共享包的现有类型检查通过，Web 构建通过。
- [ ] 浏览器手动核对禁用能力不可见且直接 HTTP 仍被拒绝；本次未执行浏览器端到端核对。

### 任务 9：集成构建与部署说明

**文件：** 修改 `docs/development.md`，更新本设计和本计划的实际完成状态；`apps/server/src/router.ts` 只通过生成器修改。

- [x] 记录 `EXTERNAL_TOKEN_VERIFICATION_URL` 完整 URL 配置、HTTPS/可信代理设置、SXWZ 入口参数、全新数据目录及服务端共享资源安装方式。指出代理不得记录查询 Token，前端清除地址栏不能撤销已写入的访问日志。
- [x] 已执行 `bun run routes`、所改共享包类型检查、Web 构建和 `bun run build:server`；Server/Web 类型检查被上述现存缺失导入阻断。
- [x] 已使用临时数据目录执行 HTTP 检查，确认认证状态、未登录拦截、跨站登录拒绝和认证文件不可静态读取。
- [x] 已检查差异与 `git diff --check`；没有新增测试/自检文件，没有 `apps/desktop` 或 `apps/mobile` 变更。独立代码审查结果以本次交付说明为准。
- [x] 交付区分实现、构建、HTTP 验证及真实账号验证边界；不执行物理数据清理或部署。

## 执行方式建议

建议在当前会话由同一实现者依次完成，因为认证上下文、配置入口、文件根目录与请求协议的接口关联紧密。各任务不是可独立上线的阶段，完整完成统一鉴权与隔离后才可作为多用户服务使用。

实施前审阅本计划并选择当前会话直接实施或使用子代理逐项实施。未经用户选择，不调度子代理。
