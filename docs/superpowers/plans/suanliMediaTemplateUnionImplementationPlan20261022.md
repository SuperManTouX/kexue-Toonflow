# SXWZ 媒体模板并集与图片上传实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让现有桌面媒体节点按 SXWZ 当前参数模板并集显示、验证和提交参数，并通过本机 Server 把工作区图片转成 Data URL 提交。

**Architecture:** 共享运行时联合类型和 Server Zod schema 接受当前模板控件；参数表单根据 `showWhen` 显示字段并编辑数值；Server 按可信模板、工作区文件引用和显式字段映射组装任务请求。登录凭证留在 Server，图片 Data URL 仅用于本次上游请求。

**Tech Stack:** Bun、TypeScript、Express、Zod、Vue 3、Element Plus、现有 `@toonflow/file` 工作区文件入口。

**Spec:** [docs/superpowers/specs/suanliMediaTemplateUnionDesign20261022.md](../specs/suanliMediaTemplateUnionDesign20261022.md)

本计划只实现新规格中的模板并集和 `imageUpload` 增量；媒体目录、任务轮询、结果校验及工作区保存已有实现，不在此重做。执行前先检查当前未提交 diff，保留其余 SXWZ 联调改动。

## Global Constraints

- 参数模板来自 SXWZ；Server 重新读取可信模型目录和模板，不信任浏览器提交的模板、Data URL、任意 URL、MIME 或文件大小。
- 本机 Server 仅从当前工作区内读取图片；拒绝越界路径、目录、不可读文件、非图片文件及超出模板数量/体积限制的素材。
- 单张图片受模板 `maxSizeMB`（存在时）和现有 100 MiB 文件上限约束；Data URL 总量受现有 HTTP 请求体上限约束。
- Data URL 不写入画布、设置、任务持久化记录或请求日志；SXWZ Token、Authorization 和完整 hidden default 不写日志。
- 新文件和目录名使用小驼峰；自有组件文件名、本地绑定名和模板标签使用小驼峰；组件属性名使用小驼峰。
- 不新增测试/自检文件、测试依赖或脚本；实现后的验证使用已有 typecheck/build、只读模板检查和手动界面核对，不额外提交生成任务。

## Review Focus

- `number` 收到 NaN、无穷值、越界值或模板 `min > max`：Task 1/4 手动核对模板拒绝原因及任务提交前校验。
- `showWhen` 条件变化后仍提交隐藏字段，或隐藏字段仍触发 required：Task 2/4 手动切换 `aspectRatio` 并检查表单值与 Server 请求校验。
- 图片路径越界、文件不存在、MIME 与文件签名不符、单张超限：Task 4 手动确认均在上游任务请求前失败。
- 多图片、首尾帧、字段数量上限和映射不明确：Task 1/4 对照只读模板清单核对映射、顺序及失败路径，不能静默截断或错配。
- 图片 Data URL、凭证或 hidden default 进入日志/持久化：Task 4/5 检查任务日志代码路径和生成请求边界，不使用真实生成任务探测。

---

## 文件与模块边界

- `packages/toolScaffold/src/runtime.ts`：媒体参数共享类型和模板字段定义。
- `apps/server/src/utils/suanli/media.ts`：上游模板 schema、模板归属校验、字段值校验和 SXWZ 任务请求组装。
- `packages/nodeShared/src/components/suanliParamsForm.vue`：控件渲染、默认值恢复、条件显示及客户端可编辑值收集。
- `packages/nodes/imageGenerationNode/src/index.vue`、`packages/nodes/videoGenerationNode/src/index.vue`、`packages/nodes/audioGenerationNode/src/index.vue`：复用现有节点引用并决定模板可生成状态；保留插件原有布局和本地供应商路径。
- `packages/nodeShared/src/mediaCapability.ts`：仅在只读模板清单证明当前标签过滤隐藏了有效 `imageUpload` 模型时，作对应能力的窄范围修正，不放宽全部 SXWZ 模型。
- `apps/server/src/utils/media/generation.ts`：在现有工作区边界内读取图片引用、检测真实 MIME、执行大小上限并把图片资料传给 SXWZ 适配。
- `apps/server/src/utils/suanli/log.ts`、`apps/server/src/utils/suanli/client.ts`：只审查请求日志边界；只有发现 Data URL 或请求体会落日志时才作最小修正。

## Tasks

### Task 1: 扩充并核对模板控件联合

**Files:**
- Modify: `packages/toolScaffold/src/runtime.ts`
- Modify: `apps/server/src/utils/suanli/media.ts`

**Interfaces:**
- `SuanliMediaParam` 增加 `ui: "number"`，字段为 `default?: number`、`min?: number`、`max?: number`；通用参数增加 `showWhen?: Record<string, string | number | boolean>`。
- `readSuanliMediaTemplate(modelRef: string)` 继续返回经平台、模型 UUID 和 schema 校验的 `SuanliMediaTemplate`；所有当前已知控件（包括 `number` 和 `imageUpload`）均可解析。

- [ ] 只读读取当前可用的全部媒体模型模板，记录 `modelRef`、模型/平台归属、模型能力标签、字段名、`ui`、数量/体积边界及 `showWhen`；不复制或输出完整 hidden default、Token 或图片数据。
- [ ] 在 `runtime.ts` 为 `number`、`showWhen` 声明联合类型；`min`、`max` 只用于数值字段。
- [ ] 在 `apps/server/src/utils/suanli/media.ts` 的 Zod 联合 schema 中镜像这些字段，并拒绝非有限数值、`min > max`、越界默认值和不支持的条件值类型。
- [ ] 允许包含已识别 `imageUpload` 控件的有效文本模板进入生成流程；上游 `code: 1` 或缺少 `data` 仍保留为上游配置错误。
- [ ] 通过本机现有模板读取入口重新读取当前模型目录；预期 Flux 与 LTX 2.3 T2V 模板通过 schema，Vidu q3 缺少上游配置时仍返回可诊断的上游错误，且不创建任务。

### Task 2: 实现数字控件与条件字段表单

**Files:**
- Modify: `packages/nodeShared/src/components/suanliParamsForm.vue`

**Interfaces:**
- 保持 `getValues(): Record<string, unknown>` 对调用节点的公开形状；返回值仅含可编辑且当前可见的参数。
- `hidden` 与 `imageUpload` 由 Server 处理，不进入节点持久化的 `suanliValues` 或浏览器提交值；条件不成立的字段不会出现在生成请求中。

- [ ] 增加 `number` 控件分支，使用 `el-input-number` 并绑定模板 `min`、`max`、`default`。
- [ ] 按 `showWhen` 对同一模板字段值做相等匹配，多个依赖条件同时满足才显示字段；条件变化时重新计算可见字段。
- [ ] 初始化时恢复当前 `modelRef` 可编辑字段的值或默认值；`hidden` 和 `imageUpload` 默认值既不写入节点数据，也不加入浏览器提交值，避免模板默认内容被持久化。
- [ ] `getValues()` 只收集当前可见、非 `hidden`、非 `imageUpload` 字段；条件隐藏字段的旧值可留在节点编辑状态供重新显示，但不能进入生成请求。
- [ ] 对可见数值执行有限值和模板边界校验；默认值或恢复值不合法时不继续生成。
- [ ] 手动核对 Flux 的 `aspectRatio=custom` 时显示宽高字段、切换离开时隐藏字段，且隐藏的旧值不进入 `getValues()`。

### Task 3: 让现有节点按模板引用能力放行图片

**Files:**
- Modify: `packages/nodes/imageGenerationNode/src/index.vue`
- Modify: `packages/nodes/videoGenerationNode/src/index.vue`
- Modify: `packages/nodes/audioGenerationNode/src/index.vue`
- Review/Modify if the inventory proves it necessary: `packages/nodeShared/src/mediaCapability.ts`

**Interfaces:**
- 节点继续通过现有 `MediaGenerationRequest` 的 `images`、`firstFrame`、`lastFrame` 传工作区相对路径；参数表单仍通过 `suanliValues` 传普通值。
- SXWZ 节点只在模板可生成且该节点引用类别能被模板 `imageUpload` 字段映射时放行；本地供应商请求和节点原有模式过滤不变。若只读清单证明现有能力标签阻止了一个有效上传模板被选中，只补齐该模板对应的能力，不全局显示无关模型。

- [ ] 使用现有节点引用列表把图片及视频首尾帧保留在生成请求中，不把路径转为 Data URL，不在 WebView 读取或编码文件。
- [ ] 更新三个节点的 `suanliReady` 与开始生成前检查：支持的图片引用由模板上传字段决定；视频/音频引用仍只有模板明确支持时才允许通过；局部重绘等未纳入范围的路径继续保持原有拒绝行为。
- [ ] 不添加新的上传服务、OSS 设置或额外占位 UI；节点原有引用预览/移除交互继续使用。
- [ ] 手动核对无参考图的 `imageUpload` 模板可以到达 Server 校验，有引用时路径随请求发送，模板无对应字段的引用会给出明确失败而不会静默忽略。

### Task 4: 在 Server 校验素材并组装 Data URL 任务体

**Files:**
- Modify: `apps/server/src/utils/media/generation.ts`
- Modify: `apps/server/src/utils/suanli/media.ts`
- Review: `apps/server/src/utils/suanli/log.ts`
- Review: `apps/server/src/utils/suanli/client.ts`

**Interfaces:**
- `prepareSuanliImageUploads(directory: string, request: MediaGenerationRequest, template: SuanliMediaTemplate, signal?: AbortSignal): Promise<Record<string, string | string[]>>` 在 `generation.ts` 内部实现；返回值只包含 Server 生成的 Data URL。
- `generateSuanliMedia(mediaType: "image" | "video" | "audio", modelRef: string, template: SuanliMediaTemplate, values: Record<string, unknown>, imageUploads: Record<string, string | string[]>, signal?: AbortSignal)` 接收服务端已验证的模板和值；`taskBody(template, values, imageUploads)` 只接受 Server 生成的上传字段，浏览器传入 `imageUpload` 字段、未知字段或隐藏条件字段均拒绝。

- [ ] 复用 `readReference` 与 `resolveWorkspacePath` 读取工作区图片；为 `readReference` 增加可选的单文件最大字节参数，使模板 `maxSizeMB` 在读入和 Base64 编码前生效，未传时沿用现有 100 MiB 上限。
- [ ] 按模板身份校验唯一 `imageUpload` 字段；按用户确认的通用契约，仅将字段名 `imageUrls` 映射到现有 `images`、`firstFrame`、`lastFrame` 引用并提交为 Data URL 数组，按字段顺序保持图片顺序；未知字段名及多个上传字段失败关闭。
- [ ] 在读取和编码前校验当前工作区、路径、文件是否为普通文件、`maxCount`、模板 `maxImages`、`maxSizeMB` 和单文件上限；缺少必需图片、超数、超大小或映射不明确时返回包含字段路径的本机错误。
- [ ] 预检全部映射文件的原始字节数及 Base64 扩张后请求体预算，合计超过 100 MiB 时在读取/编码前拒绝；读取后继续用实际文件签名校验 MIME，并在发送前校验序列化请求体不超过 100 MiB。
- [ ] 在 `taskBody` 中应用 `showWhen`、hidden default、required、默认值、选择项和 `number` 边界；不满足条件的字段不发送，浏览器额外发送隐藏值时拒绝。`imageUpload` 的模板 default 不替代本地图片，必需图片缺失时拒绝，可选上传字段无素材时省略。
- [ ] 把图片编码为 `data:<mime>;base64,...` 后仅放入上游 `body`；请求通过两次大小边界检查后才调用 SXWZ。
- [ ] 保持 `recordSuanliFailure` 只写模型标识、上游状态码、字段路径和类型等诊断，不传入任务 body、Data URL、凭证或完整 hidden default；必要时修正调用点，不扩大日志字段。
- [ ] 手动核对路径越界、MIME 不符、文件缺失、required 图片缺失、数量超限和 payload 超限都在 `requestSuanliJson("tasks", ...)` 之前失败；用源码审查确认请求日志不序列化上游任务 body。

### Task 5: 类型检查、构建与无计费核对

**Files:**
- Review: 上述实现文件

- [ ] 运行 `bun run --cwd packages/toolScaffold typecheck`、`bun run --cwd apps/server typecheck`、`bun run --cwd packages/nodeShared typecheck`、`bun run --cwd packages/nodeScaffold typecheck`、`bun run --cwd packages/tools/mediaGeneration typecheck`。
- [ ] 对三个节点分别运行 `bun run --cwd packages/nodes/imageGenerationNode typecheck`、`bun run --cwd packages/nodes/videoGenerationNode typecheck`、`bun run --cwd packages/nodes/audioGenerationNode typecheck`。
- [ ] 运行 `bun run --cwd apps/server build` 及三个受影响节点的 `build` 脚本；若 Server 仍被缺失的生成型 `ElectrobunConfig` 阻断，记录原始错误并单独报告，不将其归因到媒体变更。
- [ ] 在 Linux 联调桌面端手动读取 Flux、LTX 2.3 T2V 及当前有效 `imageUpload` 模板，核对控件、默认值、条件显示和字段映射；Vidu q3 只核对上游失败诊断。
- [ ] 检查工作区变化只包含本任务的必要代码文件；不运行自动测试，不点击生成、不提交新的 SXWZ 任务。

## 覆盖核对

| 规格要求 | 计划任务 |
| --- | --- |
| 当前控件并集、`number`、默认值和 `showWhen` schema | Task 1、Task 2、Task 4 |
| 条件字段显示与 Server 同步校验 | Task 2、Task 4 |
| 当前有效、唯一 `imageUrls` 上传字段的本地图片映射；未知形状失败关闭 | Task 1、Task 3、Task 4、Task 5 |
| 工作区路径、文件/MIME/数量/体积和上传边界 | Task 4 |
| 不接收客户端 Data URL，不落日志/持久化，不配置 OSS | Task 3、Task 4、Task 5 |
| Vidu q3 上游错误与不发任务 | Task 1、Task 5 |
| 不新增测试、自检和算力任务 | Task 5 |
