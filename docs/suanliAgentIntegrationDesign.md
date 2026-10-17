# Suanli Agent 接入设计

## 目标

在现有 Agent 对话入口接入由算力中台完全管理的模型目录。文本模型继续使用 Agent 的工具循环；非文本模型根据 AIGC 返回的请求模板渲染表单，提交异步任务。上传控件通过服务端使用阿里云 OSS 的 S3 兼容接口。

## 已确认的产品行为

- Agent 的模型列表来自算力中台，不从用户可编辑的 `customProviders` 模型列表生成。
- 文本模型继续使用当前 Agent 输入区与 `tools/tool_calls` 工具循环。
- 非文本模型选中后显示该模型的动态表单，并通过任务接口提交。
- AIGC 模板字段由配置接口返回的 `params` 数组驱动。已给出的控件类型包括 `textarea`、`proportion`、`hidden`、`dimension`、`quantity`、`resolution`、`select` 和 `imageUpload`。字段的 `name`、`label`、`default`、`required`、`options`、`dimension`、`maxCount` 决定表单与请求值。
- 用户身份字段由服务端验证 SXWZ 登录结果后注入，浏览器不能指定 `user_id`、`school_id` 或 `sessionId`。
- 当前 Toonflow 页面没有课程上下文，任务和聊天请求先不传可选的 `course_id`。

## 模型目录与模板

服务端并行读取算力中台的模型目录，并分页读取课程模型：

- `GET /suanli/v1/models` 返回 OpenAI 风格模型标识。
- `GET /suanli/v1/platforms/course-models` 使用可信学校 ID 与服务端 Bearer 凭证查询，按 `pageSize` 上限分页到 `total`。
- 按 `models[].id` 与 `courseModels[].name` 合并模型信息。每条课程模型记录保留为独立可选项，以免相同模型名在不同平台下的 UUID 或平台编码被折叠。合并结果保留 `models[].id` 作为 AIGC 模板查找键，也保留 `courseModels[].id` UUID 作为聊天和任务接口的 `model_id`，并带上 `kind`、`category`、展示名和平台编码。
- Agent 只允许选择能够映射到算力模型 UUID 的模型；不会自行生成模型 ID。
- 非文本模型模板通过 AIGC 的批量配置接口取得：`POST /open/models/configs`，按 `/suanli/v1/models` 返回的字符串 `id` 批量查询并装配进完整模型目录。用户选中非文本模型时，通过 `GET /open/models/{modelId}/config` 获取该模型最新配置；两者都使用同一字符串模型 ID 和 `params` 结构。AIGC 基础地址为 `https://talkingdraw.xueai.art/aigc`。
- 服务端校验模型目录和模板结构；前端只负责按模板呈现控件。未知 `ui` 类型不猜测其语义，应显示明确的不可用错误并阻止提交。

## 文本模型与 Agent 工具

文本模型继续沿用 Agent runtime 和其 OpenAI-compatible provider 适配器，将请求代理到 `POST /suanli/v1/chat/completions`。适配层把 Agent 生成的 `model` 转换成算力模型 UUID 字段 `model_id`，同时注入 `platform_code`、`client_task_id`、`sessionId`、`user_id` 和适用时的 `school_id`。`tools` 和流式 `tool_calls` 保持 OpenAI 兼容结构，使现有 Agent 工具循环继续工作。

Agent 前端仍发送普通对话消息；客户端不直接访问算力中台，也不提交身份字段。工具调用、取消和会话记录沿用当前 Agent runtime 的事件与会话机制。

## 非文本模型与 OSS

- 选中 `kind` 为非文本类型的模型时，Agent composer 显示对应的 `params` 表单。
- 字段默认值用于初始化表单；`required` 在提交前检查；`hidden` 字段不显示但保留其默认值；枚举控件使用 `options`；尺寸字段按 `dimension` 的范围与分隔符组装；上传字段遵循 `maxCount`。
- `imageUpload` 文件通过 Toonflow 服务端上传到阿里云 OSS 的 S3 兼容端点。OSS 凭证只保存在服务端配置中。任务请求的 `body` 使用上传后 URL 填充对应字段。
- 表单提交到 `POST /suanli/v1/tasks`。服务端验证模型属于当前目录并注入身份信息；前端通过 Toonflow 后端代理查询 `GET /suanli/v1/tasks/{task_id}`，并在适用时代理排队任务取消。
- 任务完成结果在当前 Agent 对话中展示。

## 身份与配置

内部 Toonflow `userId` 继续用于本地用户隔离；算力请求另使用 SXWZ 验证响应里的外部 `userId`、`sessionId` 和学校 ID。敏感字段只在服务端身份上下文和服务端请求中使用，不写入前端设置或日志。学校 ID 缺失时不调用要求学校身份的课程模型列表。

算力与 AIGC 使用独立基础地址和服务端凭证配置。OSS 使用独立的 S3 兼容 endpoint、bucket、region、访问密钥和公开 URL 配置；这些值不下发浏览器。具体部署值由服务环境注入。

## 需要对齐的接口契约

1. Apifox 目前把 AIGC `modelIds` 和 `ModelConfig.modelId` 定义为整数；用户确认模板查询键应使用 `/suanli/v1/models` 返回的字符串 `id`。批量与单模型配置接口的实际服务都必须接受该字符串，并按同一键返回配置。
2. Apifox 当前文本接口文档没有声明 `tools`、流式 `tool_calls`，SXWZ 响应示例也显示学校 ID 可能嵌套在教育身份对象内。实现按已确认的运行契约接入，但应在联调前核对实际请求/响应结构。
3. 本地仓库没有 OSS S3 客户端或现成 OSS 配置；实现需增加服务端 S3 兼容上传能力，并由部署环境提供 OSS 参数。

## 不在本次范围

- 新建独立对话页面或修改媒体生成节点入口。
- 让用户编辑算力模型目录或模板。
- 为未提供定义的额外 `ui` 类型推测控件行为。
- 在当前没有课程上下文时伪造或从浏览器接受 `course_id`。
