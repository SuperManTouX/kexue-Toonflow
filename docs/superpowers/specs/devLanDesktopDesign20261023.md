# Linux 桌面开发页局域网访问设计

## 目标

允许开发者在 Linux 桌面桥接开发模式中，从同一局域网的浏览器通过 Linux 主机的局域网 IP 打开完整桌面开发页，并使用工作区与设备互联功能。普通开发模式、生产服务和已打包桌面应用继续执行现有本机访问限制。

## 当前问题

- Linux 的 `bun run dev` 会启动带 `?desktop=1&linuxDevWorkspace=1` 的 Vite 页面，Vite 使用 `--host` 对网络接口监听。
- Vite 代理保留浏览器的 Host。以 `http://192.168.x.x:5173` 打开时，Server 收到的 hostname 是局域网 IP。
- 桌面接口、设备互联管理、工作区管理及 MCP/A2A Host 控制分别检查 loopback 地址或 localhost hostname，导致桌面启动握手和 Host 功能返回 403。
- Server 当前通过未指定 hostname 的 `app.listen` 监听所有接口，开发 API 端口可能被直接从局域网访问。

## 访问方式

- 新增服务端环境变量 `TOONFLOW_DEV_LAN=1`，仅允许与 `NODE_ENV=dev`、Linux 桌面桥接开发模式同时使用；其他组合启动时明确报错。
- LAN 页面经 Vite 访问；Vite 只将连接来源位于 Linux 主机活动私有网络接口子网内的请求标记为可信 LAN 开发请求。支持 RFC 1918 IPv4 和 IPv6 ULA。Vite 覆盖客户端同名请求头，不能直接信任浏览器提供的标记。
- LAN 开关开启时，Server 只监听 `127.0.0.1`，拒绝从局域网直接连接开发 API 端口。Server 仅在 LAN 开关开启、请求由本机 Vite 代理转入、来源标记可信且 Origin 与 Host 同源时，将请求视作 LAN 桌面页面请求。
- 桌面开发页输出局域网访问地址；页面仍带 `desktop=1` 和 `linuxDevWorkspace=1` 参数。
- 设备互联监听器保持现有行为：用户在界面开启共享后绑定 `0.0.0.0`，供同一局域网的配对设备连接。默认端口仍为 43123。

## 权限边界

- 可信 LAN 桌面请求可使用现有桌面启动接口、设备互联管理接口和本机工作区/插件管理能力；对应能力覆盖当前分散的本机 Host 检查，包括 desktop middleware、workspace helper、mobileLink control、MCP/A2A control 和 SXWZ 桌面请求。
- “可信 LAN”由 Vite 基于本机网络接口的 CIDR 与请求源地址判断；不接受公网来源，不采用客户端可伪造的 `X-Forwarded-For`。
- LAN 开发模式关闭时，现有监听地址、loopback、同源及 `x-toonflow-local-client` 检查保持原样。
- LAN 开发模式下，同一主机活动局域网子网中能够访问 Vite 端口的设备都可操作开发工作区与桌面 Host API；该行为由用户显式启用，不配置口令。
- 不更改已打包应用、生产 Server、普通 Web/Server 开发模式的访问策略；不把 Server API 端口对 LAN 开放。

## 涉及模块

- `scripts/devStack.ts`：识别并向 Web、Server 进程传递 LAN 开发开关；拒绝非 Linux 桌面模式使用该开关。
- `apps/web/vite.config.ts`：检测连接来源是否属于主机活动接口子网，并覆盖代理请求的可信来源标记。
- `apps/server/src/index.ts`：仅在 LAN 开关开启时将业务 Server 绑定到 loopback。
- `apps/server/src/lib/localRequest.ts`：增加统一的本机或可信 LAN 桌面请求判断，复用 loopback 与同源校验。
- 桌面、工作区、设备互联、MCP/A2A 和 SXWZ Host 入口：改用统一判断，避免只修复启动握手而其他 Host 功能仍返回 403。
- `docs/development.md`：说明启用方式、访问 URL、需要放行的端口及其局域网权限范围。

## 错误处理

- LAN 开关与 Linux 桌面桥接开发模式组合不合法时，开发栈启动前报错，不静默降级。
- LAN 请求来源不在主机任一活动私有网络接口子网中时，Vite 标为非可信来源，Server 按原有本机策略拒绝 Host 能力。
- Origin 不匹配、请求标记缺失或请求未经过 loopback 上的 Vite 代理时，Server 拒绝本机管理请求。
- 设备互联端口仍只在用户开启共享后监听；端口占用继续沿用现有配置错误处理。

## 验收标准

1. 未设置 LAN 开关时，使用局域网 IP 打开桌面页不能调用本机 Host 管理接口；localhost/127.0.0.1 开发行为不回归。
2. 在 Linux 执行 `TOONFLOW_DEV_LAN=1 bun run dev` 后，同一活动子网的浏览器可通过局域网 IP 打开桌面页，`/api/desktop/ready` 成功，启动页不报“仅允许桌面页面发起操作”。
3. 页面可读取和保存 Linux 桌面开发工作区，并管理设备互联；LAN 配对设备可经已启用的设备互联端口连接。
4. 从局域网直接访问 Server 业务端口失败；未启用 LAN 开发模式时，普通 Web/Server 模式与生产请求仍受现有限制。
5. 不新增项目测试代码；实现后按仓库规定执行必要的 typecheck/build，并用同网段请求手动验证允许与拒绝路径。

## 不包含

- 不开放互联网或跨网段桌面管理，不实现访问口令、用户角色或设备白名单。
- 不修改 Windows/macOS 桌面调试或其原生打包流程。
- 不更改设备互联的配对协议、端口默认值、目录授权模型或已有设备 token 生命周期。
- 不新增自动化测试文件、测试框架或 CI 检查入口。
