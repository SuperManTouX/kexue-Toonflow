# Suanli Agent 接入设计

## 目标

在现有 Agent 对话和图片、视频、音频生成节点接入由算力中台完全管理的模型目录。文本模型继续使用 Agent 的工具循环；Agent 中的非文本模型和媒体节点根据 AIGC 返回的请求模板渲染表单，提交异步任务。上传控件通过服务端使用阿里云 OSS 的 S3 兼容接口。

## 已确认的产品行为

- Agent 的模型列表来自算力中台，不从用户可编辑的 `customProviders` 模型列表生成。
- 文本模型继续使用当前 Agent 输入区与 `tools/tool_calls` 工具循环。
- Agent 中选中非文本模型后显示该模型的动态表单，并通过任务接口提交。
- 图片、视频、音频节点只显示对应平台的算力模型：`ai_painting_talk`、`ai_video_talk`、`ai_music_talk`；选中后复用 AIGC 模板表单，通过任务接口生成并把结果保存到当前工作区节点输出。
- AIGC 模板字段由配置接口返回的 `params` 数组驱动。已给出的控件类型包括 `textarea`、`proportion`、`hidden`、`dimension`、`quantity`、`resolution`、`select` 和 `imageUpload`。字段的 `name`、`label`、`default`、`required`、`options`、`dimension`、`maxCount` 决定表单与请求值。
- 用户身份字段由服务端验证 SXWZ 登录结果后注入，浏览器不能指定 `user_id`、`school_id` 或 `sessionId`。
- 当前 Toonflow 页面没有课程上下文，任务和聊天请求先不传可选的 `course_id`。

## 模型目录与模板

服务端并行读取算力中台的模型目录，并分页读取课程模型：

- `GET /suanli/v1/models` 返回 OpenAI 风格模型标识。
- `GET /suanli/v1/platforms/{code}/models` 使用可信学校 ID 与服务端 Bearer 凭证，分别查询 `ai_chat`、`ai_painting_talk`、`ai_video_talk` 和 `ai_music_talk` 四个平台的默认授权模型；`ai_chat` 是文本模型平台。
- `GET /suanli/v1/platforms/course-models` 也按这四个 `platform` 分别查询，使用可信学校 ID 与服务端 Bearer 凭证，并按 `pageSize` 上限分页到 `total`。
- 默认授权模型与课程授权模型合并；同一平台内同一 UUID 合并，不同平台重复出现的 UUID 保留为独立选项，因为请求需要对应的 `platform_code`。内部用 `platformCode:UUID` 作为选择键，上游 `model_id` 仍发送 UUID。只展示这两个接口返回的 UUID 模型，单独出现在 `/suanli/v1/models` 的字符串 ID 不作为模型选项。按模型名称关联 `/suanli/v1/models[].id` 的分类信息。AIGC 模板使用平台或课程模型接口返回的 UUID 查询。`ai_chat` 平台的模型统一作为文本模型走 Agent 对话；其余平台按中台返回的 `kind` 判断走 Agent 对话还是任务表单。
- 非文本模型模板通过 AIGC 的批量配置接口取得：`POST /open/models/configs`，`modelIds` 使用平台或课程模型接口返回的 UUID；响应 `data` 按 UUID 返回模板。装配时同时核对模板的 `modelId` 与 `platformId`，相同 UUID 出现在不同平台时不跨平台套用模板。`GET /open/models/{modelId}/config` 使用同一 UUID，并核对平台后从模板 `params` 渲染表单。AIGC 基础地址为 `https://talkingdraw.xueai.art/aigc`。
- 所有可选模型必须保留平台模型或课程模型接口返回的 UUID；服务端不自行生成模型 ID，也不把仅出现在 `/models` 的字符串 ID 单独展示。相同 UUID 属于多个平台时，选择键额外包含平台编码。
- 服务端校验模型目录和模板结构；前端只负责按模板呈现控件。未知 `ui` 类型不猜测其语义，应显示明确的不可用错误并阻止提交。

## 文本模型与 Agent 工具

文本模型继续沿用 Agent runtime 和其 OpenAI-compatible provider 适配器，将请求代理到 `POST /suanli/v1/chat/completions`。适配层把 Agent 生成的 `model` 转换成所选中台模型标识 `model_id`，对平台/课程模型同时传入 `platform_code`；并注入 `client_task_id`、`sessionId`、`user_id` 和适用时的 `school_id`。`tools` 和流式 `tool_calls` 保持 OpenAI 兼容结构，使现有 Agent 工具循环继续工作。

Agent 前端仍发送普通对话消息；客户端不直接访问算力中台，也不提交身份字段。工具调用、取消和会话记录沿用当前 Agent runtime 的事件与会话机制。

## 非文本模型与 OSS

- Agent composer 选中 `kind` 为非文本类型的模型时，显示对应的 `params` 表单。
- 图片、视频、音频生成节点分别按 `ai_painting_talk`、`ai_video_talk`、`ai_music_talk` 过滤模型，选择器完全使用算力中台目录。选中算力模型时，节点使用相同模板控件，不显示原供应商的生成参数，提交到 Toonflow 的节点媒体任务路由。
- 字段默认值用于初始化表单；`required` 在提交前检查；`hidden` 字段不显示但保留其默认值；枚举控件使用 `options`；尺寸字段按 `dimension` 的范围与分隔符组装；上传字段遵循 `maxCount`。
- `imageUpload` 文件通过 Toonflow 服务端使用 `@aws-sdk/client-s3` 上传到阿里云 OSS 的 S3 兼容端点。OSS 是可选配置，且仅用于提供远端任务可读取的图片 URL；本地用户工作区、身份和会话数据不存入 OSS。未配置可用 OSS 时，聊天和不含必填图片字段的任务仍可用；图片字段会显示不可用提示，含必填图片字段的任务不能提交。OSS 凭证只保存在服务端配置中。
- Agent 表单提交到 `POST /suanli/v1/tasks`。服务端验证模型属于当前目录并注入身份信息；前端通过 Toonflow 后端代理查询 `GET /suanli/v1/tasks/{task_id}`。取消前由服务端重新确认上游任务仍为 `queued`，其他状态不发出取消请求。
- 媒体节点提交到 Toonflow 的节点生成路由。服务端验证模型平台和节点类型匹配，轮询算力任务至终态，下载并校验结果媒体后写入用户工作区，成功时将文件路径设为节点输出；节点取消或请求断开时中止轮询与下载。
- 任务卡写入 Agent 会话记录；重开对话后恢复非终态任务并继续查询，终态结果同步回会话。任务归属记录过期或不可查询时，会话卡片记为 `unavailable` 并停止轮询；提交接口若直接返回终态，会保留其结果和错误。

## 身份与配置

内部 Toonflow `userId` 继续用于本地用户隔离；算力请求另使用 SXWZ 验证响应里的外部 `userId`、`sessionId` 和学校 ID。敏感字段只在服务端身份上下文和服务端请求中使用，不写入前端设置或日志。学校 ID 缺失时不调用要求学校身份的课程模型列表。

算力与 AIGC 使用独立基础地址和服务端凭证配置。OSS 使用独立的 S3 兼容 endpoint、bucket、region、访问密钥和公开 URL 配置；这些值不下发浏览器。具体部署值由服务环境注入。

## 需要对齐的接口契约

1. Apifox 将 AIGC `modelIds` 和 `ModelConfig.modelId` 标为整数，但实际批量与单模型接口已验证接受平台模型 UUID，并在 `data` 键和 `modelId` 字段中返回该 UUID。
2. Apifox 将 `/suanli/v1/chat/completions` 的 `model_id` 描述为 UUID，而 `/suanli/v1/models` 返回模型名字符串。实现只展示平台模型或课程模型接口提供的 UUID；`/models` 的字符串 ID 用于名称关联和分类信息。AIGC 模板按同一 UUID 查询。一个 UUID 可能属于多个平台，模型选择与后端解析必须同时保留平台编码。
3. Apifox 当前文本接口文档没有声明 `tools`、流式 `tool_calls`，SXWZ 响应示例也显示学校 ID 可能嵌套在教育身份对象内。实现按已确认的运行契约接入，但应在联调前核对实际请求/响应结构。
4. 本地仓库没有 OSS S3 客户端或现成 OSS 配置；实现需增加服务端 S3 兼容上传能力，并由部署环境提供 OSS 参数。

## 不在本次范围

- 新建独立对话页面。
- 让用户编辑算力模型目录或模板。
- 为未提供定义的额外 `ui` 类型推测控件行为。
- 在当前没有课程上下文时伪造或从浏览器接受 `course_id`。
