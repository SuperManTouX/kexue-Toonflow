# 桌面端 SXWZ 媒体生成实施计划

> 仓库规范禁止新增测试模块；使用现有类型检查、构建和手动联调验证。SXWZ 任务适配已实现；用户授权的一次 Z-image 上游任务已确认 PNG 结果契约，未重复提交计费任务。

**Goal:** 让桌面端现有图片、视频、音频生成节点使用已登录 SXWZ 账号的个人算力，并把结果安全保存到本地工作区。

**Architecture:** 本机 Server 扩展现有 SXWZ 模型目录，通过 SXWZ 模型参数接口读取模板，提交并轮询任务，只解析已确认的 `vendor_raw.eventData.results` 结果项。WebView 只传模型引用和用户输入，`sessionId`、用户身份与 Bearer token 均由 Server 注入；不再请求旧 AIGC 配置后端。

**Tech Stack:** Bun、TypeScript、Express、Zod、Vue 3、现有 `@toonflow/tool-media-generation` 与 `@toonflow/nodes-scaffold` 媒体调用接口。

**Spec:** [docs/superpowers/specs/desktopSxwzMediaDesign20261021.md](../specs/desktopSxwzMediaDesign20261021.md)

## Global Constraints

- 媒体任务只使用 `ai_painting_talk`、`ai_video_talk`、`ai_music_talk`，并分别要求 `category` 为 `image`、`video`、`audio`。
- 模型引用使用 `platformCode:modelUuid`；只接收当前已登录会话可见目录中的模型。
- 个人桌面计费使用服务端读取的 `sessionId`；不传 `course_id`，不信任客户端传入的用户、学校或会话字段。
- SXWZ token 只由本机 Server 从加密会话读取，不进入 WebView、普通设置、错误信息或日志。
- 保留本地媒体供应商、节点和工作区保存流程；不迁移工作区到数据库或 OSS。
- 不把参考素材静态密钥编入应用；无安全上传契约的模板不能提交。
- 所有新文件、目录、变量、自有组件和 DOM 类名遵守仓库小驼峰规则；路由每个文件只注册一个 HTTP 方法和路径。
- 不新增测试模块、测试依赖或测试脚本；不把构建和检查隐式绑定到开发命令。

## Review Focus

- 同一模型 UUID 出现在不同平台：Server 和浏览器都用 `platformCode:modelUuid` 保持唯一性。
- 平台目录出现未知、缺失或错误 `category`：不能把模型展示到错误媒体节点。
- AIGC 模板缺失、格式异常或包含未知控件：不能退回硬编码参数后继续提交。
- 提交请求被取消、响应中断或状态转为 `processing`：不能重复提交或谎称上游任务已取消。
- 任务返回任意 `vendor_raw`、外部 URL、错误 MIME 或多结果：只处理契约明确支持的媒体字段并复用现有大小、内容和路径校验。

## Tasks

### Task 1: 关闭上游契约与计费确认门

**Files:**
- Modify: `docs/superpowers/specs/desktopSxwzMediaDesign20261021.md`

**Interfaces:**
- 生成链路开始前必须具备可重复的 SXWZ JSON 参数模板响应、任务完成结果的正式媒体字段，以及可解释的计费元数据。
- 音频节点只在音乐平台实际返回至少一个 `category: "audio"` 模型后进入实现范围。

- [x] 用当前登录会话读取三个媒体平台的默认目录，并核对 UUID、类别与计费字段。
- [x] 核对 Apifox 的任务创建、查询与取消响应结构；确认正式链路可能预扣费，取消只支持排队任务。
- [x] 从 Apifox 确认新的 SXWZ 单查/批查路径、UUID 参数、模板响应结构及 200/未找到语义。
- [x] 使用真实图片和视频 UUID 请求 `GET /suanli/v1/models/{modelId}/config`，并用批量 `POST /suanli/v1/models/configs` 验证响应；旧 AIGC 配置路径已弃用。
- [x] Apifox 说明 `billing_mode: "pre"` 按 `unit_price` 预扣，`"post"` 按 `pre_frozen_amount` 预扣，终态响应含实际 `cost`。
- [x] 用户授权的一次 Z-image 任务返回 `vendor_raw.eventData.results` 数组，结果包含 `url` 和 `outputType: "png"`；只解析该精确路径，不递归搜索 `vendor_raw`。
- [ ] 确认安全参考素材上传路径；若没有，实现继续禁用需要上传素材的模板，但不阻止无参考素材模板的任务链路。

**Gate:** 图片任务结果样本和计费字段已确认，可实现纯文本无参考素材的任务链路。一次性测试额度已使用；其他真实任务仍可能计费，不自动再次提交。视频/音频结果格式和参考素材上传路径仍未验证，未知格式安全失败。

### Task 2: 扩展并筛选 SXWZ 媒体模型目录

**Files:**
- Modify: `apps/server/src/utils/suanli/models.ts`
- Modify: `apps/server/src/utils/suanli/types.ts`
- Modify: `apps/server/src/utils/media/generation.ts`

**Interfaces:**
- 扩展后的 SXWZ 目录保留模型 UUID、平台编码/名称、显示名、`kind`、`category` 和上游计费字段。
- 媒体模型映射返回现有 `MediaModel` 字段：`providerId: "suanli"`、组合 `modelId`、`providerLabel`、`label` 和 `type`。

- [x] 将 `ai_video_talk`、`ai_music_talk` 加入当前支持平台集合，同时保留聊天、编程和绘画目录的现有行为。
- [x] 将媒体平台编码映射到固定媒体类别；仅转换 `kind: "task"` 且类别严格匹配的目录项。
- [x] 对重复 UUID/平台组合和目录响应结构使用现有上游格式错误处理；缓存键继续绑定当前登录身份。
- [x] 把符合条件的目录项并入 `/api/ai/media/models`；`ai_music_talk` 没有音频类别时不产生 SXWZ 音频模型。
- [x] 本地已有模型列表继续保留；SXWZ 媒体目录只返回模型字段，不包含 token、sessionId 或身份数据。

### Task 3: 增加已验证的 SXWZ 参数模板与任务适配

**Files:**
- Create: `apps/server/src/utils/suanli/media.ts`
- Modify: `apps/server/src/utils/suanli/client.ts`
- Modify: `apps/server/src/utils/suanli/index.ts`
- Modify: `apps/server/src/utils/media/generation.ts`
- Modify: `apps/server/src/utils.ts`

**Interfaces:**
- `readSuanliMediaTemplate(modelRef: string)` 返回只包含经真实响应校验的模型模板字段。
- `generateSuanliMedia(mediaType, modelRef, values, signal)` 返回通过结果契约验证的上游媒体 URL；`generateMedia` 复用现有内容探测和工作区保存后返回 `GeneratedMedia[]`。
- 函数输入中的 `modelRef` 必须经 `getSuanliModelByRef` 校验；任务请求中的 `model_id`、`platform_code`、`sessionId` 和用户身份由 Server 重建。

- [x] 通过现有 `requestSuanliJson` 调用 SXWZ 单查参数接口，实现响应 Zod schema、模型/平台归属验证和控件验证；不调用旧 AIGC 路径。
- [x] 按模板把表单值映射到任务 `body`；缺必填值、未知字段或需上传但未配置的模板均在发任务前拒绝。
- [x] 按 Apifox 任务请求结构发送 `model_id`、`platform_code`、`client_task_id`、模板 `body` 和当前会话 `sessionId`；不提交 `course_id`，不采信浏览器身份字段。
- [x] 提交响应未知或连接中断时先用同一 `client_task_id` 查询，不重新提交；轮询处理全部文档终态并遵守取消信号。
- [x] 仅在 `queued` 时请求上游取消；`processing` 时停止本机等待，不向用户声称上游已停止。
- [x] 仅解析 `vendor_raw.eventData.results`；验证 HTTPS 地址、输出类型、响应 MIME/文件签名和大小，复用工作区边界、独占原子写入及失败清理。

### Task 4: 把已验证模板能力接入现有媒体节点

**Files:**
- Modify: `packages/toolScaffold/src/runtime.ts`
- Modify: `packages/nodeScaffold/src/nodeAi.ts`
- Create: `packages/nodeShared/src/components/suanliParamsForm.vue`
- Modify: `packages/nodeShared/package.json`
- Modify: `packages/nodes/imageGenerationNode/src/index.vue`
- Modify: `packages/nodes/videoGenerationNode/src/index.vue`
- Modify: `packages/nodes/audioGenerationNode/src/index.vue`

**Interfaces:**
- 当前节点通过独立模板读取路由获取经校验的 SXWZ 参数；生成时把当前模型引用和表单值传给 Server 任务适配。
- 模板表单只渲染已支持控件；三个节点各自保留插件专属布局。

- [x] 为生成请求增加有界模板参数对象，并在路由 schema 与 Server 模板校验中拒绝未知字段。
- [x] 图片、视频和音频节点载入 SXWZ 模型后读取模板、显示模板控件；支持的无参考素材模板调用 SXWZ 任务适配。
- [x] 模型切换时按当前 `modelRef` 恢复对应字段，否则使用模板默认值；切回本地模型继续走原有链路。
- [x] 无匹配类别模型时保持 SXWZ 模型不可选，不添加占位模型或虚构音频能力。

### Task 5: 静态构建与桌面浏览器联调

**Files:**
- Modify: `apps/server/src/router.ts`（仅在增加路由文件时，由生成器更新）
- Modify: `docs/superpowers/specs/desktopSxwzMediaDesign20261021.md`

- [x] 新增模板读取路由后，在 `apps/server` 执行 `bun run routes`，并核对为 `GET /api/ai/media/template`。
- [x] 已按模块运行类型检查和构建；本轮 Server 类型检查只被仓库现有缺失的 `./.hutch/devkit/api/config/ElectrobunConfig` 阻断，mediaGeneration、toolScaffold、nodeScaffold 和三个媒体节点类型检查通过。Server、mediaGeneration 和三个媒体节点构建通过；Web 上一轮构建通过，nodeScaffold/nodeShared 没有 build 脚本。
- [ ] 桌面浏览器检查未完成：当前浏览器策略拒绝读取 `127.0.0.1` 页面；开发栈已重启并保持运行，未通过其他方式绕过该限制。
- [x] 已执行一次经用户授权的 Z-image 上游任务并保存 PNG，记录 `cost: "7.0000"`、`unit_price: 700`、`thirdPartyConsumeMoney: 0.01`。
- [ ] 本轮没有再通过画布按钮提交任务，因为一次性计费授权已经用于上述上游样本；节点路由的端到端计费联调仍待另一次额度授权。当前没有音频模型，不发音频任务。
- [ ] 核对现有 SXWZ 文本对话、OpenAI 兼容流式输出、工具调用和历史会话保持原路径。

## 当前状态

任务提交、状态轮询、超时/失败处理、排队取消、结果格式验证和本地工作区保存已实现；三个媒体节点可使用无参考素材的模板，类别过滤和原有本地供应商保留。一次实际 Z-image 任务确认了图片结果结构。下一步需要在浏览器策略允许时手动检查 UI，并在用户另行授权后通过节点按钮进行端到端计费验证。视频/音频真实结果字段、参考素材上传和音频目录仍未确认/不可用。
