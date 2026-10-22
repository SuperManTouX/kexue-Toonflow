# 桌面端 SXWZ 媒体生成设计

**状态：SXWZ 媒体任务链路已实现；图片节点上游任务已验证，节点按钮联调尚待继续**

**日期：2026-10-21**

## 目标

在已接入的桌面 SXWZ 登录和文本 Agent 基础上，让现有图片、视频、音频生成节点能够使用 SXWZ 算力。用户工作区和生成结果继续保存在本机；登录凭据、上游请求及任务轮询由本机 Server 管理。

本阶段不改动现有 SXWZ 文本 Agent 适配；媒体迭代完成后仍需核验对话回归，也不新建媒体工作台或 Agent 非文本模型流程。

## 范围

- 图片节点从 `ai_painting_talk`、视频节点从 `ai_video_talk`、音频节点从 `ai_music_talk` 源目录选择模型；目录必须同时按源平台编码和模型 `category` 过滤，不能仅凭平台编码判断媒体类型。
- 模型展示名从 SXWZ 模型目录读取，请求参数模板从 SXWZ 模型参数接口读取；不要求用户在媒体供应商设置中维护 SXWZ API Key。
- 节点按已验证的 SXWZ 模板显示当前模型需要的参数；生成结果通过现有媒体结果校验、工作区路径边界和本地保存流程写入所选工作区。
- 保留本地媒体供应商和它们的模型、设置及生成链路。

不包含课程模型、`course_id`、3D 生成、视频 Agent、Agent 对话页非文本任务、数据库/OSS 工作区迁移及发布包配置界面。

## 平台目录与授权

本机 Server 使用已登录 SXWZ 会话的 `Authorization: Bearer <token>` 获取启用平台，再调用：

```text
GET /suanli/v1/platforms/{platformCode}/models?school_id={trustedSchoolId}[&college_id={trustedCollegeId}]
```

服务端只接受 `ai_painting_talk`、`ai_video_talk`、`ai_music_talk` 三个媒体源平台，并校验响应中的源平台编码、模型 UUID、名称和类型。前端使用组合引用 `platformCode:modelUuid`，实际任务字段由服务端从当前会话和模型目录重建；请求上游媒体任务时设置 `platform_code: "toonflow"`，源平台编码仍用于本机目录和模板归属校验。

个人桌面项目没有课程上下文，因此使用平台默认模型目录；不请求 `/suanli/v1/platforms/course-models`，不从客户端接受或伪造 `course_id`。SXWZ 用户、学校、会话及可用的学院信息均从本机已验证登录会话注入。

## 模板与节点参数

Apifox 已将 AIGC 配置查询迁移到 SXWZ 中台。单个模型使用 `GET /suanli/v1/models/{modelId}/config`，批量查询使用 `POST /suanli/v1/models/configs`，请求体为 `{ "modelIds": ["<model UUID>"] }`，最多 200 个。单个接口的路径参数与批量接口的数组元素均使用 SXWZ 模型目录返回的 UUID。两接口均标注免认证；应用通过现有 SXWZ API 客户端请求 `https://sxwz.xueai.art`，不再访问旧 AIGC 后端。

响应结构为 `{ code, data }`；配置含 `id`、UUID `modelId`、平台编码 `platformId`、`inputType`、`maxImages`、`promptPlaceholder` 和 `params` 控件数组。Apifox 与实时接口确认 `params` 为数组，字段包含控件类型、提交字段名、标签、默认值、必填标记及可选项等。图片实时样本包含 `textarea`、`proportion`、`resolution`、`select`；视频实时样本包含 `textarea`、`select`、`proportion`、`resolution`、`switch`。实现已对模板做 Zod 校验，仅渲染已支持控件；未知控件或需要上传参考图的模板不可生成。参考分支的静态 OSS 密钥仍不可采用。

两个实时样本确认主提示词字段为 `prompt`，且参数模板可由新中台接口读取；服务端已校验模板模型 UUID、平台归属和控件结构，节点按模板显示参数。正式任务适配尚未实现，待结果契约确认后再由服务端按模板组装任务 `body`，不猜字段别名或硬编码供应商参数。

### 参考素材上传边界

现有节点把参考素材作为本地工作区文件引用。模板含 `imageUpload` 时，Server 必须在校验工作区文件后把素材传到 SXWZ 能访问的 URL，再将 URL 填入任务 `body`。目前 Apifox 未提供 SXWZ 上传接口。不能把静态 OSS 密钥编入桌面安装包，也不能把本地文件路径交给上游。

因此首轮实现只启用无需远程参考素材的模型模板。需要上传素材的模板在上传方式和凭据归属确认前标记为不可用；不配置上传时不能静默忽略素材或报告生成成功。后续如需图生图、参考图/音频/视频或首尾帧，先确定 SXWZ 上传接口、短期上传凭据或其他受信任的上传服务。

## 任务调用与结果保存

节点调用现有 `/api/ai/media/models` 读取合并后的模型目录，并通过 `/api/ai/media/template` 按 UUID 读取参数模板。支持纯文本、无需参考素材的模板后，图片、视频节点通过现有 `/api/ai/media/generate` 调用 SXWZ 任务；如果音乐平台后续返回音频类模型，音频节点走相同适配。SXWZ 不从普通 `mediaProviderConfigs` 加载供应商。

本机 Server 校验工作区、媒体类型、`platformCode:modelUuid`、当前登录会话和模板参数，然后以 Bearer token 提交：

```text
POST /suanli/v1/tasks
```

请求包括服务端从 SXWZ 模型目录取得的 UUID `model_id`、`platform_code: "toonflow"`、`client_task_id`、模板 `body` 和已登录会话的 `sessionId`。`model_id` 必须使用目录返回值，不能使用浏览器提交的模型名或自行拼造；模型参数通过 SXWZ 参数接口读取，正式任务提交到 `/suanli/v1/tasks`。Apifox 将 `sessionId` 列为必填，并说明它用于个人预扣费；`course_id` 是组织扣费路径，与 `sessionId` 二选一，本产品没有课程上下文，不传 `course_id`。`user_id` 仅在组织扣费时为必填，由服务端从登录身份注入；调用学校自有模型时才传可信的 `school_id`。Apifox 将任务接口标注为外部调用免认证且 `Authorization` 可选；客户端仍按已确认格式附上登录态 Bearer，但不能据此认定任务接口会校验该头。提交响应不确定时，先按同一 `client_task_id` 查询任务状态，不重新提交可能已计费的任务。

Apifox 提交响应结构为 `{ code: 0, data: { task_id, client_task_id, status, position } }`；`task_id` 由服务端生成，`status` 初始为 `queued` 或 `processing`。Apifox 说明 `billing_mode: "pre"` 按 `unit_price` 预扣，`billing_mode: "post"` 按 `pre_frozen_amount` 预扣，终态返回实际 `cost`。任何真实提交都可能计费；已获授权的单次图片任务已执行，后续节点按钮联调不自动重复提交。

生成请求保持现有节点的等待生命周期；桌面本机 Server 无法作为公网回调地址，由 Server 轮询 `GET /suanli/v1/tasks/{task_id}` 直到 `completed`、`failed`、`cancelled` 或 `timeout`。状态接口的路径参数可传 `task_id` 或 `client_task_id`。查询响应字段包含任务身份、状态、费用、`usage`、`error` 和可能为空的 `vendor_raw`；任务记录约保留 72 小时，过大时可能为 `null`。已完成的 Z-image 实际响应确认媒体结果位于 `vendor_raw.eventData.results`；结果数组项包含 `url`、`text`、`nodeId`、`zindex`、`outputType`，本次 `outputType` 为 `png`。实现仅解析这个精确位置，按 `outputType` 限定媒体类别，再通过现有大小限制、MIME/文件签名探测和工作区保存流程处理，不递归寻找任意 URL。视频与音频结果尚无真实完成样本；不匹配已支持类型/格式的响应会安全失败。

取消沿用节点的 AbortSignal。Apifox 已明确 `POST /suanli/v1/tasks/{task_id}/cancel` 只支持 `queued`；成功响应为 `{ code: 0, message, data: { task_id, cancelled } }`，非排队状态返回 409 `invalid_state`。若任务已进入 `processing`，上游已提交第三方、不能取消；本机停止等待并明确保留“上游可能继续运行并计费”的状态，不声称已经取消上游任务。

## 安全与本地数据

- SXWZ token 只由本机 Server 从加密会话存储读取，使用 Bearer 请求；不下发 WebView、不写普通设置或日志。
- 模型 ID、平台、用户、学校和会话字段由 Server 根据当前授权目录与登录身份重建，忽略浏览器提供的同名身份字段。
- 上传和结果下载遵守现有工作区边界、媒体类型、大小限制及内容探测规则；只处理任务响应契约明确标记的媒体结果，不递归下载任意 `vendor_raw` URL。
- 登录失效清除本机 SXWZ 会话并要求重新登录；不会删除本机项目、会话历史或生成文件。

## 复用与实施边界

- 复用现有生成节点、媒体路由和工作区文件保存逻辑；避免另建任务页面、第二套媒体历史或专用持久化数据库。
- 已只读查看 `codex/suanli-node-media` 分支。其 `params` 数组与新中台返回结构相符，但请求旧 AIGC 地址的实现应改用 `/suanli/v1/models/{modelId}/config` 或 `/suanli/v1/models/configs`；静态 OSS 凭据和递归提取结果 URL 仍不能采用，也不能直接搬用其多用户 `getCurrentUser().suanliIdentity` 路径。
- 按仓库规范修改 `apps/server` 路由时每个文件只注册一个方法/路径，随后运行 `bun run routes`。不新增测试或自检模块；实现阶段使用现有 typecheck、构建和经授权的手动联调。

## 已知限制与待确认契约

1. 图片与视频模型参数接口已在新 SXWZ 路径获得成功实时响应；其他模型模板仍需按 UUID 读取，并对未知控件保持不可用。
2. Z-image 样本已确认图片结果字段；视频/音频的模型供应商是否采用相同 `eventData.results` 结构仍待真实结果验证，解析失败时不会递归抓取 `vendor_raw`。
3. 上传参考素材所需的 SXWZ 接口、访问方式、大小和类型限制，以及授权如何安全地下发给桌面用户。此项确认前，带上传字段的模板保持不可用。
4. Apifox 把任务接口标记为免认证，且 `Authorization` 可选；客户端仍按用户确认的格式发送 `Authorization: Bearer <token>`，个人计费关联使用服务端注入的 `sessionId`。Apifox 文档未说明任务接口是否验证 Bearer 身份。

## 验收标准

1. 登录 SXWZ 后，三个现有媒体节点只展示启用平台中 `category` 与节点类型一致的默认授权模型；未登录时现有本地媒体模型仍可用。当前实查的音乐平台没有音频类模型，因此音频节点不得展示其返回的图片类工作流。
2. 模型参数接口返回真实样本、任务结果字段确认后，无参考素材的受支持模板能完成对应任务；任务状态与失败能被节点正确显示，输出经验证后保存到当前工作区。
3. 模型、平台或身份字段被浏览器伪造时，Server 拒绝请求或用可信目录/会话字段替换；登录失效不会回退到其他共享凭据。
4. 用户取消时，仅在上游仍排队时发起取消；处理中不向用户保证上游已停止。
5. 需要 `imageUpload` 的模板在安全上传方式确认前不可提交；应用包和普通用户设置中没有共享 OSS 密钥。
6. `ai_chat`/`ai_coding` 文本对话及其 OpenAI 兼容流式响应、工具调用和会话历史不回归。

## 2026-10-21 上游实查结果

- 使用本机已登录 SXWZ 会话只读查询了授权模型目录；没有提交生成任务，也没有触发算力扣费。图片平台返回 10 个模型，均为 `kind: task`、`category: image`；视频平台返回 9 个模型，主要为 `category: video`，但其中 `runninghub-comfyui` 是 `category: image`，证明需按 category 二次过滤；音乐平台当前只返回一个 `category: image` 的 `runninghub-comfyui`，没有音频类模型。对应的 Server 筛选和节点目录合并已实现。
- 单个实时目录模型记录包含 `id`、`name`、`display_name`、`kind`、`category`、`billing_unit`、`billing_mode`、`unit_price`、`input_price`、`output_price`、`cache_hit_price`、`pre_frozen_amount`、`tags`、`sort_order`、`source_type`。视频样本的计费元数据为 `billing_unit: "piece"`、`billing_mode: "post"`、`unit_price: "700.0000"`、`pre_frozen_amount: "150.0000"`；Apifox 说明 `pre` 按 `unit_price` 预扣、`post` 按 `pre_frozen_amount` 预扣，任务终态返回实际 `cost`。没有提交真实任务，因此实际费用结算表现仍未验证。
- 实查到的示例模型 UUID：图片 `7ff1c7fe-e44e-4408-ab11-7404c99ffe02`（jimeng-4.6）；视频平台中的 `Vidu-q2-turbo`、`LTX 2.3 T2V`；音乐平台的唯一返回模型 `2c3cbd55-02a4-4c36-b3be-85e8ffa3bf98`（工作流，category 为 image）。模型目录返回 UUID，而不是整数 ID。
- `2c3cbd55-02a4-4c36-b3be-85e8ffa3bf98` 在多个平台目录中重复出现且均指向工作流，必须继续使用 `platformCode:modelUuid` 作为模型引用，不能只按 UUID 查找。
- 本轮实现已将视频和音乐平台加入支持白名单；媒体目录继续按 `kind: task` 和严格 `category` 过滤，音乐平台当前没有音频模型。
- SXWZ 文本模型列表 `GET /suanli/v1/models` 返回 OpenAI 风格模型目录，不包含媒体任务参数；媒体参数使用独立的 `/suanli/v1/models/{modelId}/config` 或 `/suanli/v1/models/configs`。
- 按真实目录 UUID 在 `https://sxwz.xueai.art` 实查单个图片模型参数接口，匿名 `GET /suanli/v1/models/{modelId}/config` 返回 HTTP 200、`code: 0`；`data.modelId` 与 UUID 一致，`platformId` 为 `ai_painting_talk`，`params` 含 `prompt`、`aspectRatio`、`resolution`、`quality` 四个字段。单个视频模型同样返回 HTTP 200，`platformId` 为 `ai_video_talk`，`params` 含 `prompt`、`style`、`aspectRatio`、`resolution`、`duration`、`audio` 六个字段。
- 批量 `POST /suanli/v1/models/configs` 使用 `{ "modelIds": [imageUuid, videoUuid] }` 返回 HTTP 200、`code: 0`；响应 `data` 以 UUID 为动态键，映射到每个模型的配置。AIGC 配置后端和旧域名已废弃，代码与运行时请求均使用 SXWZ 基础域名。
- Apifox 任务状态接口确认 `{task_id}` 路径参数接受实际 `task_id` 或 `client_task_id`；终态含 `usage`、`cost`、`error` 和可能为空的 `vendor_raw`。取消只接受 `queued`。
- 经用户授权提交了一次 Z-image 图片任务，未重试或再次提交。上游状态为 `completed`，`vendor_raw.eventData.results` 返回 1 个结果，字段为 `url`、`text`、`nodeId`、`zindex`、`outputType`，`outputType` 为 `png`；图片已下载并通过 `image/png` 响应头及 PNG 文件签名核验。账单响应原值为 `cost: "7.0000"`、`usage.unit_price: 700`、`usage.resp.eventData.usage.thirdPartyConsumeMoney: 0.01`，不对不同字段作单位换算。
- 上述生成由一次性上游任务调用验证，不是画布节点按钮的端到端回归。已接入节点适配和本地保存；受浏览器访问策略限制，本轮未完成画布页面手动操作，也未重复产生计费任务。

## 规模与主要风险

这是跨 Server、现有媒体节点和工作区文件保存的改动；不需要改造本地工作区存储。纯文本无参考素材任务已接通，图片已取得真实上游结果样本。剩余边界是参考素材上传契约、视频/音频真实结果样本，以及画布按钮路径的手动回归；音乐平台当前仍无音频类别模型。
