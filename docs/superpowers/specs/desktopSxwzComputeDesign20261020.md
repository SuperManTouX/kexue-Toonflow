# Toonflow 个人桌面端接入 SXWZ 算力设计

**状态：** 文本 Agent 首期代码已实现；待 SXWZ 真实账号与算力接口联调

**日期：** 2026-10-20

## 已确认的前提

- 交付形态是个人桌面端：每位用户本机运行，设置和工作区留在本机，SXWZ 提供算力。
- 算力授权主体是 Toonflow 应用级别，不是每位用户各自配置一把算力 API Key。
- 桌面端提供 SXWZ 登录表单并发起 SXWZ 登录，不再要求宿主平台通过启动 URL 或外部注入 `sxwzToken`；登录前先获取图形验证码，用户输入后随账号密码提交。
- 桌面账号密码登录优先使用 `appLogin`，由本机 Toonflow Server 代理登录和 `validateToken`；不使用自动注册接口。
- `data.token`、经验证的用户身份和应用级算力授权在代码中分开处理；当前为调用算力接口暂复用已校验登录 token，是否能取得约定的应用级额度仍须 SXWZ 实际部署验证。
- `validateToken` 使用 `Authorization: Bearer <token>`；用户确认 token 登录后保持不变。
- 算力模型按 SXWZ 平台目录接口获取；当前 Apifox 示例包含 AI 对话、AI 编程、AI 绘画三个平台。
- SXWZ 文本接口返回完整 OpenAI 兼容格式，可复用现有文本流与工具调用适配。
- 用户已确认首期接入文本 Agent，多模态后续处理。

## 当前实现与验证状态

- 桌面登录表单通过本机 Server 获取图形验证码并调用 `appLogin`，再用 `Authorization: Bearer <token>` 调用 `validateToken`；密码和验证码不落盘，token 与最小身份字段加密写入本机 `data/auth/`，不返回 renderer。
- 账号状态和模型目录接口只允许本机桌面请求；模型目录查询三个启用平台的默认模型，不查询课程模型。Agent 选择器只显示 `ai_chat`、`ai_coding` 文本模型。
- Agent 使用 OpenAI Completions 适配器，保留现有 messages、tools、stream 及工具调用流程；Server 重新校验模型引用并注入 SXWZ 模型和身份字段。
- `apps/server` 与 `apps/web` 构建已通过。两端 `typecheck` 均被 worktree 缺少 `./.hutch/devkit/api/config/ElectrobunConfig` 阻断；不是本次改动引出的源码诊断。没有执行测试代码。
- 未用真实 SXWZ 账号验证登录字段、身份数据、模型目录、streaming/tool_calls 或算力授权归属。当前按其它分支示例把已校验登录 token 用作 `/suanli/v1` 的 Bearer；若 SXWZ 要求独立应用凭据，不能把静态密钥打包进客户端，需改用上游签发的短期凭据或算力代理。

## 目标

面向个人用户提供 Windows 桌面安装包。每位用户在自己的电脑上运行一份 Toonflow；设置、Agent 对话、项目和工作区文件继续保存在本机；文本 Agent 模型由 SXWZ 算力中台提供。

首期复用现有 Agent 对话和工具调用循环，打通模型授权、模型目录、流式文本生成和本地历史保存。不建设供多用户共享的 Toonflow Web 服务，不把用户工作区迁到 PostgreSQL 或 OSS。

## 当前代码依据

- `apps/desktop/src/index.ts` 在桌面进程中创建本机数据目录并复用 `@toonflow/server/app`；未传 `authMode`。
- `apps/server/src/app.ts` 默认 `authMode` 为 `local`。本地模式提供单一宿主用户，并保留宿主管理能力；SXWZ Web 多用户模式会改变用户目录及宿主管理边界。
- `apps/server/src/index.ts` 只为独立 Web Server 显式指定 `authMode: "sxwz"`。现有 Web 登录仍走外部 `sxwzToken` 验证：`apps/server/src/utils/auth/verify.ts` 返回 `userName`、`sessionId`，不返回算力接入设计所需的完整身份字段，也不保存原始 Token。本设计只替换桌面登录入口，不隐含删除或改造 Web 登录流程。
- 当前 Agent 文本请求通过 `customProviders` 选择 OpenAI Completions、OpenAI Responses 或 Anthropic Messages 兼容供应商。内置 TF-Router 指向 Toonflow 服务，不是 SXWZ 算力中台适配器。
- `docs/suanliAgentIntegrationDesign.md` 已记录 SXWZ 算力模型目录、文本接口和非文本任务的设计，但是假设后端持有服务凭据，并且多模态上传依赖 OSS；尚未发现对应的应用代码实现。
- `docs/superpowers/specs/saasStorageDesign20261020.md` 面向 SaaS 服务部署，明确不包含桌面端。本设计不复用它的 PostgreSQL/OSS 工作区存储方案。

## Apifox 登录接口现状

已查看 Apifox 项目 `kexuetest`（ID `8125889`）下的模块「实训网站-用户侧服务」（ID `8744460`）。接口定义状态均为 `released`，登录目录当前包含以下接口：

| 接口 | 请求 | Apifox 定义的用途/响应 |
| --- | --- | --- |
| `GET /api/captcha/generate` | 无 body；`Authorization` 可选 | 响应为 `status/message/data`；Apifox 只把 `data` 定义为字符串映射。运行时已确认成功响应含 `captchaImage`（Base64 图片）与 `captchaId`。 |
| `POST /api/login/appLogin` | `LoginDto`：`username`、`password`、`captchaId`、`captchaValue`、`roleType` | 描述仍称 APP 登录不需要图形验证码，但登录运行要求先获取验证码并提交 `captchaId`、`captchaValue`；响应为 `status/message/data`，其中 `data` 是 `LoginUserDto`。 |
| `POST /api/login/accountLogin` | 同 `LoginDto` | 用户登录；响应同上。 |
| `POST /api/login/appLoginWithRegiste` | 同 `LoginDto` | 描述为用户不存在时自动注册；桌面登录不应默认使用这个会创建账号的接口。 |
| `POST /api/login/validateToken` | 无 body；带 `Authorization` 请求头 | 响应同 `LoginUserDto`，用于校验 token 并返回用户信息。 |
| `POST /api/login/validateTokenAndReturnUserId` | 无 body；带 `Authorization` 请求头 | 响应为 `CommonResultObject`，但 `data` 当前没有定义具体字段。 |
| `POST /api/login/phoneLogin` | `PhoneLoginDto`：`phone`、`code`、`inviteCode`、`roleType`、`wxid` | 手机号验证码登录；响应同 `LoginUserDto`。 |
| `POST /api/login/sendCode` | 查询参数 `phone` | 发送手机验证码；响应 `CommonResultString`。 |
| `POST /api/login/checkPhone` | `schoolName`、`logoUrl`、`phone`、`validCode` | 返回手机号、学校 ID/名称和是否新用户。 |
| `POST /api/login/accountLogout` | 无 body；带 `Authorization` 请求头 | 用户登出；响应 `CommonResultString`。 |

`LoginUserDto` 定义为 `{ token, userInfo, roles, permissions }`；本项目 Apifox 的字段名是 `token`，并非之前方案草稿中的 `sessionToken`。`validateToken` 的响应 schema 将 `userInfo` 引用到 `SysUser`，其中列有 `pwd`、`salt`、`sessionId`、`schoolId` 等字段；这是 schema 声明，不足以证明运行时都会返回这些字段。身份适配应只提取必需字段，并避免保存或记录密码摘要、盐值等无关字段。

登录请求模型没有声明必填字段，但运行时登录要求包含 `captchaId` 与 `captchaValue`；验证码接口运行时返回 `captchaImage` 与 `captchaId`。`LoginDto.roleType` 与 `SysUser.roleType` 的角色编号说明也不一致。用户已确认 `validateToken` 使用 `Bearer` 前缀且 token 登录后保持不变；`roleType` 是否必填及枚举值仍需确认。

按接口描述，桌面账号密码表单优先评估 `appLogin`，但需确认“APP 端”涵盖桌面客户端；若需要注册流程，`appLoginWithRegiste` 会改变账号状态，应另行明确。不要把手机号验证码流程与账号密码登录混为一条链路。

算力调度模块当前定义了以下获取和调用接口：

| 接口 | 用途与关键字段 |
| --- | --- |
| `GET /suanli/v1/platforms/list` | 获取启用的平台编码和名称；当前已发布的 Apifox 示例包含 `ai_chat`（AI 对话）、`ai_coding`（AI 编程）、`ai_painting_talk`（AI 绘画）。桌面端只支持这三个编码，并与接口实际返回的启用平台取交集。 |
| `GET /suanli/v1/platforms/{code}/models` | 按平台获取当前用户可见的默认模型；需要 `school_id`，可选 `college_id`。响应提供模型 UUID、名称、`kind`、分类等目录字段。仅查询启用且属于桌面端支持集合的平台；身份参数由本机 Server 从已验证登录态注入。该接口不含课程限时模型。 |
| `GET /suanli/v1/platforms/course-models` | 获取 `model_usage=course` 的课程限时模型；接口说明定位为老师课程模型配置页，需 `school_id`，可按 `platform`、`category` 分页筛选，并说明需 Bearer。首期桌面端没有课程上下文，不调用此接口。 |
| `POST /suanli/v1/chat/completions` | OpenAI 兼容聊天；请求包含 `model_id`、`messages`、`sessionId`，可带 `stream`、`platform_code`、`client_task_id`、`course_id`、`user_id`、`school_id`。`sessionId` 和组织身份字段由本机 Server 注入。 |

首期目录按以下规则实现：先读取启用平台，再与 `ai_chat`、`ai_coding`、`ai_painting_talk` 支持集合取交集，逐个平台读取默认模型；模型选项使用平台接口返回的 UUID 和 `platform_code`。`/suanli/v1/models` 返回 OpenAI 格式的字符串模型名，不作为此目录的选项来源。Agent 文本选择器只允许当前 Agent 可处理的文本模型；绘画平台目录不代表首期接入绘画生成。

首期不查询或合并课程模型：桌面端没有当前课程，也没有可信 `course_id` 来源；平台默认模型接口足以支持当前模型选择。聊天接口 schema 将 `sessionId` 列为必填，描述则称 `sessionId` 与 `course_id` 按计费场景二选一，因此个人桌面首期按 `sessionId` 路径调用、不传 `course_id`。将来若增加课程上下文和课程模型功能，再接入课程模型分页查询，并先核实该二选一规则及课程模型接口 Bearer 要求；该接口的说明写需 Bearer，而 header schema 标为非必填。

算力接口的 `Authorization` 默认可选，部署设置 `AUTH_REQUIRED=true` 时强制 Bearer；仍需确认目标部署设置，以及 Bearer 使用登录用户 token 还是独立应用级凭据。`chat/completions` 的 schema 展开了标准非流式响应和 SSE 说明，但没有完整展开工具调用及流式 chunk 字段；实现按用户已确认的完整 OpenAI 兼容响应处理，并在真实联调时核验。

## 产品边界

### 首期包含

- Windows x64 个人桌面安装包，继续使用现有桌面 Server、数据目录、安装器和更新机制。
- Toonflow 以应用级授权调用 SXWZ 算力；如算力请求仍需归因到个人，则个人身份从经 SXWZ 验证的登录上下文取得。模型清单由 SXWZ 管理，不从用户自定义供应商列表伪造或复制。
- 用户通过桌面登录表单进入 SXWZ 登录流程；不再使用外部传入的 `sxwzToken` 建立桌面端登录。
- 文本模型通过现有 Agent runtime 生成回答，并保留现有 `tools`、流式 `tool_calls`、取消和会话记录机制。
- Agent 请求、SXWZ 凭据和身份字段均由桌面本机 Server 处理；渲染进程不能指定或覆盖 SXWZ `user_id`、`school_id`、`sessionId` 等身份值。
- 用户设置、凭据引用、对话历史和工作区内容留在本机；卸载和更新沿用现有保留数据语义。

### 首期不包含

- 多人共用一台 Toonflow 服务、SaaS 用户目录、团队协作、跨设备同步、云端历史备份。
- PostgreSQL、OSS 工作区镜像或对象索引。
- 图片、视频、音频等非文本模型目录、动态参数表单、异步生成任务及上传工作流。
- 将共享的 SXWZ 服务凭据打包进 EXE。

## 架构

桌面 WebView 继续访问本机 Toonflow Server，并展示 SXWZ 登录表单。弹窗打开时由本机 Server 代理 `GET /api/captcha/generate`，向用户展示 `captchaImage` 并保留本次 `captchaId`；用户输入 `captchaValue` 后，账号、密码及验证码字段一起提交给 `appLogin`。Server 再将响应中的 `data.token` 以 `Authorization: Bearer <token>` 形式传给 `validateToken`。用户确认登录后 token 保持不变。校验成功后，Server 只保存必要的身份字段和本机侧凭据，不把 SXWZ token 返回给 renderer。当前实现暂将该 token 作为 `/suanli/v1` 的 Bearer；这依赖目标部署把应用级算力授权正确映射给已登录用户，仍需真实联调确认。

```text
桌面 WebView
  → 登录表单 → 本机 Toonflow Server
      → SXWZ captcha/generate → captchaImage + captchaId
      → 用户输入 captchaValue → SXWZ appLogin → data.token → SXWZ validateToken
      → 本机 Toonflow Server（只保存白名单身份字段与本机凭据引用）
  → 本机 Toonflow Server
      → SXWZ 平台列表 → 各平台模型目录
      → SXWZ 文本生成 / 流式 tool_calls（按契约附加用户会话）
  ← Agent runtime 事件流

设置、会话和工作区文件 → 用户本机 data/ 与工作区目录
```

本机宿主身份与 SXWZ 登录/算力身份是不同概念。桌面继续保持 `authMode: "local"`，以保留本地文件、插件和宿主管理能力；新增独立的 SXWZ 会话上下文。不能通过把桌面整体切成 `authMode: "sxwz"` 来实现 SXWZ 登录或模型授权。

SXWZ 表单登录用于建立用户身份/会话；模型列表按启用的平台编码获取，算力请求使用对应平台编码和模型 UUID。本机 Server 不接受客户端自行提交的 `user_id`、`school_id`、`college_id`、`sessionId` 作为身份声明。当前算力请求使用登录 token 的 Bearer，并由 Server 注入经过验证的身份字段；需确认目标部署的 `AUTH_REQUIRED`、应用级授权额度和用户费用归属与此方式兼容。

## 组件改动范围

| 区域 | 需要完成的工作 |
| --- | --- |
| 桌面登录与授权状态 | 增加 SXWZ 登录表单、图形验证码、登录/验证状态和算力连接状态；使用本机 Server 代理验证码、`appLogin` 与 `validateToken`；不走自动注册接口；不改变本地宿主权限模式。 |
| 本机凭据管理 | 管理 SXWZ 登录返回的 `token` 与算力 API Bearer 凭据；不保存用户密码，不把 SXWZ token 返回 renderer；不得把静态应用私钥打包进 EXE、写入日志或下发到模型上下文。 |
| Server 算力适配 | 获取启用的平台列表、逐平台读取模型目录、校验模型映射并调用统一聊天接口；按上游要求注入计费会话及可信用户/学校身份；沿用 OpenAI 兼容文本响应与流式 `tool_calls` 处理。不得复用或扩张 Web 多用户的数据隔离模式。 |
| Agent 模型选择 | 在现有 Agent 模型选择链路中支持 SXWZ 管理的目录；模型选择仍由本机 Server 校验并解析为可信模型记录。 |
| 设置与本地历史 | 继续复用现有本地配置及 Agent 会话持久化；只持久化必要的登录状态/安全凭据引用，不把密码或 token 写入一般用户设置、localStorage 或日志。 |
| 桌面发布 | 复用现有 Windows 构建与安装包流程；验证全新安装、登录、更新后数据保留、卸载保留，以及普通用户安装目录的写权限。 |

## 凭据与身份原则

- 算力使用应用级授权；个人 SXWZ 身份是独立的可选归因上下文，不能从客户端字段、显示名称或模型请求中推断。
- SXWZ 登录表单提交的账号凭据只用于 SXWZ 登录，不持久化密码；Apifox 中返回的用户 `token`、经验证的 SXWZ 身份、算力 API Bearer 凭据和 Toonflow 本机登录态分别管理。只有 SXWZ 契约明确允许时，才可将一种凭据用于另一种用途。
- 登录表单提交至本机 Server，由本机 Server 调用 SXWZ 登录和校验接口；渲染进程不直接持有 SXWZ `token`。
- SXWZ `token` 不得写入 renderer 的 localStorage、普通设置文件或日志。优先由本机 Server 管理会话，并使用系统凭据库保存需要跨重启保留的凭据；如果 SXWZ 不允许安全续期或设备并发使用，需明确再次登录的影响。
- 若应用级授权本身是静态私钥，就不能把它编译进可分发 EXE 或放进普通桌面配置文件。纯本地模式需要 SXWZ 提供面向桌面客户端的授权交换/短期凭据；否则需由可信服务端代理持有私钥。代理只处理算力请求，不要求将 Toonflow 工作区或用户历史迁到云端。
- 纯本地模式下即使使用系统凭据库，也不能向拥有该电脑账户/管理员权限的用户保证应用凭据不可提取；系统凭据库用于避免凭据进入 WebView 和普通设置文件。
- 算力身份只用于上游请求；本机工作区仍使用原有宿主本地边界。模型选择、`user_id`、`school_id` 等身份值都由 Server 校验或注入。
- SXWZ 授权丢失、过期或上游不可用时，明确返回登录/服务错误；不静默退回共享账号、匿名请求或自定义模型。

## 未确认的上游契约

以下内容仍需 SXWZ 接口维护方确认，或在实现联调时核实：

1. Apifox 的登录 `token` 与此前接入记录提到的 `sessionToken` 是否是同一服务/同一凭据；此前记录的单会话互踢行为是否适用于当前 API，登录、登出和过期语义分别是什么。用户已确认 token 登录后保持不变。
2. SXWZ 是否接受桌面客户端使用 `appLogin`；账号登录中 `roleType` 是否必填、具体枚举值是什么。当前 schema 标注的可选字段和角色编号存在冲突。
3. `validateToken` 的 200 响应如何区分有效和无效 token，失败状态码及 body 是什么；`userInfo` 是否会返回 `pwd`、`salt` 等 SysUser schema 字段。应使用必要字段白名单；`validateTokenAndReturnUserId` 的 `data` 当前未定义。
4. 算力 API 的 `AUTH_REQUIRED` 在目标部署中是否开启；若开启，Bearer 使用登录用户 token 还是独立应用级凭据。应用级授权对应的额度和费用如何归属。
5. `sessionId` 与 `course_id` 二选一的实际规则，以及个人桌面用户走哪种扣费路径；`user_id`、`school_id` 和 `college_id` 的来源及必填条件。
6. `/platforms/list` 的实际启用平台和各平台可见模型目录；Apifox 示例目前列出三个平台编码，模型列表仍需由运行时接口返回确定。
7. 用户已确认文本接口返回完整 OpenAI 兼容格式；Apifox schema 未展开工具调用和 SSE chunk 字段，需在联调中核验工具调用、取消、错误及额度耗尽语义。
8. 登录 token 或算力授权能否在多设备同时使用；一处登录或登出是否会撤销其他会话。

上线与宣布接入完成前须按真实 SXWZ 契约确认上述内容；不能以 Apifox schema 或其它分支示例代替上游运行验证。

## 失败处理与数据边界

- 授权和模型目录请求失败时，不清除或覆盖用户本机工作区和历史记录。
- 算力接口超时、拒绝或流中断时，沿用现有 Agent 失败/取消语义；不得把失败报告成成功，也不自动重放可能已计费的请求。
- 用户撤销授权只清除 SXWZ 凭据及算力上下文，不删除工作区、对话历史或桌面设置。
- SXWZ 返回的媒体任务和图片上传不在首期范围，因而首期不需要为工作区增加 OSS 持久化。

## 验收标准

1. Windows x64 桌面版在单用户本机模式启动；无需 PostgreSQL、OSS 或部署方运行共享 Toonflow Server。应用级授权通过经确认的安全方式取得，不在安装包中暴露静态私钥。
2. 用户能通过客户端 SXWZ 登录表单获取并输入图形验证码后登录，`data.token` 经 `validateToken` 验证并按确认的上游语义处理过期；应用级授权单独遵循其有效期策略；退出或撤销授权不会删除本机数据。
3. Server 返回的模型清单来自 SXWZ；客户端伪造模型和 SXWZ 身份字段不能改变实际请求身份或模型映射。
4. 选定文本模型后，Agent 可完成普通流式回复、现有工具调用循环和取消；上游错误不会导致本机历史/设置损坏。
5. 打包安装、应用更新及卸载保留行为不破坏本机数据；真实 SXWZ 接口验证单独记录，构建成功不当作算力联调通过。

## 主要风险与估算边界

- **文本 Agent 首期：中等改动。** 完整 OpenAI 兼容响应可复用现有文本流和工具调用处理；主要新增集中于应用级授权取得、模型目录、必要的用户归因及模型选择。
- **全模态接入：中高到高。** 需增加 Schema 驱动表单、媒体文件上传/托管、异步任务状态、取消、结果下载及本地文件导入；是否需要短期 OSS 取决于 SXWZ 上传契约。
- **中心化 SaaS：单独项目。** 多用户 Web、PG/OSS 工作区存储、共享服务鉴权和运维不属于本设计，也不是个人桌面版的前置条件。
- 当前最大不确定性是 SXWZ 如何向桌面安全发放应用级算力授权，以及额度按应用还是个人归属。若只能使用静态私钥，须在纯本地方案和轻量算力代理之间作选择；前者无需 Toonflow 数据库，后者可能需要为身份、限额或审计增加服务端状态存储。
