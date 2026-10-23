# Linux Desktop LAN Development Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an explicitly enabled Linux desktop bridge development stack to serve the full desktop development page to browsers on the same private LAN.

**Architecture:** Vite identifies requests from the host's active private interface subnets and overwrites a proxy marker. With LAN mode enabled, the Server binds only to loopback and accepts that marker only on proxied same-origin requests; a shared local-host predicate extends the existing desktop, workspace, device-link, MCP/A2A, and SXWZ checks. Production, packaged apps, and other development modes keep their current access policy.

**Tech Stack:** Bun, TypeScript, Vite, Express, Node `net` and `os` standard libraries.

**Spec:** `docs/superpowers/specs/devLanDesktopDesign20261023.md`

## Global Constraints

- “新增服务端环境变量 `TOONFLOW_DEV_LAN=1`，仅允许与 `NODE_ENV=dev`、Linux 桌面桥接开发模式同时使用；其他组合启动时明确报错。”
- “Vite 只将连接来源位于 Linux 主机活动私有网络接口子网内的请求标记为可信 LAN 开发请求。”
- “LAN 开关开启时，Server 只监听 `127.0.0.1`，拒绝从局域网直接连接开发 API 端口。”
- “LAN 开发模式关闭时，现有监听地址、loopback、同源及 `x-toonflow-local-client` 检查保持原样。”
- “不更改已打包应用、生产 Server、普通 Web/Server 开发模式的访问策略；不把 Server API 端口对 LAN 开放。”
- Follow `AGENTS.md`: do not add test modules; use existing typecheck/build commands and required manual HTTP verification.

## Review Focus

- **Invalid mode combinations:** `TOONFLOW_DEV_LAN=1` with non-Linux, non-desktop, or non-dev startup must fail before services are spawned. Manually invoke each invalid combination and confirm the clear startup error.
- **LAN source classification:** requests from each active private interface subnet are marked; loopback stays local; non-private or out-of-subnet sources are not trusted. Manually verify using a same-subnet client and inspect proxy behavior for loopback.
- **Spoofed proxy marker:** a browser-supplied marker must be overwritten, and the backend port must not accept direct LAN connections. Send a spoofed marker through Vite and attempt a direct request to port 3000 from a peer.
- **Origin and host consistency:** a same-subnet request with mismatched Origin must still fail, while the actual LAN page origin succeeds. Verify both with browser devtools or curl from a peer.
- **Device-link exposure:** the `43123` listener is reachable from a peer only after the user enables sharing; disabling it closes the listener. Verify pairing over LAN after enabling and connection failure after disabling.

---

### Task 1: Add LAN mode and Vite proxy attestation

**Files:**
- Modify: `scripts/devStack.ts`
- Modify: `apps/web/vite.config.ts`

**Interfaces:**
- Consumes: `TOONFLOW_DEV_LAN=1` set by the developer when launching `bun run dev` on Linux.
- Produces: the same mode flag for the Web and Server child processes; Vite proxy header `x-toonflow-dev-lan-client` set to `1` only for accepted clients and overwritten for every `/api`, `/mcp`, and `/a2a` proxy request.

- [ ] **Step 1: Validate and propagate the mode in `scripts/devStack.ts`**

Reject `TOONFLOW_DEV_LAN=1` unless the invocation is `desktop` and `process.platform === "linux"`, before creating child processes. Pass the flag to both child processes only for this valid desktop run. Keep ordinary `bun run dev:web`, `bun run dev:server`, and non-desktop stack startup behavior unchanged.

- [ ] **Step 2: Add private-subnet request classification to `apps/web/vite.config.ts`**

Use `networkInterfaces()` and each interface's CIDR to classify Vite's incoming socket address. Allow only RFC 1918 IPv4 and IPv6 ULA addresses that fall in an active interface subnet. Normalize IPv4-mapped IPv6 addresses. In LAN mode, overwrite `x-toonflow-dev-lan-client` to `1` for an accepted LAN source and `0` otherwise; overwrite `x-toonflow-local-client` consistently so the existing workspace path cannot trust a browser-supplied value. Preserve the existing local loopback behavior.

- [ ] **Step 3: Run frontend typecheck and inspect LAN startup output**

Run: `bun run --cwd apps/web typecheck`

Expected: typecheck passes; a valid LAN desktop run starts Web and Server with the same mode flag, and Vite prints its Network URL for LAN access. The stack's existing loopback URL remains useful for the host's local browser.

- [ ] **Step 4: Commit the mode and proxy changes**

```bash
git add scripts/devStack.ts apps/web/vite.config.ts
git commit -m "feat: identify trusted LAN desktop dev requests"
```

### Task 2: Apply one server-side local-host policy

**Files:**
- Create: `apps/server/src/lib/localRequest.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/routes/workspaces/selectDirectory.ts`
- Modify: `apps/server/src/lib/desktop.ts`
- Modify: `apps/server/src/utils/workspace/index.ts`
- Modify: `apps/server/src/utils/mobileLink/index.ts`
- Modify: `apps/server/src/utils/suanli/http.ts`
- Modify: `apps/server/src/utils/mcp/control.ts`
- Modify: `apps/server/src/agent/a2a/settings.ts`

**Interfaces:**
- Consumes: Vite's overwritten `x-toonflow-dev-lan-client` marker, same-origin browser headers, loopback connection from Vite, and the server-side `TOONFLOW_DEV_LAN` flag.
- Produces: `isLocalDesktopHost(req: Request): boolean`, which accepts the existing valid loopback host path or an opted-in, trusted, same-origin LAN desktop request that arrived through the loopback-bound Vite proxy.

- [ ] **Step 1: Validate the mode and add `isLocalDesktopHost`**

At the start of `apps/server/src/index.ts`, reject `TOONFLOW_DEV_LAN=1` unless `NODE_ENV === "dev"`, `TOONFLOW_DEV_DESKTOP_WEB === "1"`, and `process.platform === "linux"`; this also protects direct Server starts that bypass `scripts/devStack.ts`. Then add `isLocalDesktopHost` in `apps/server/src/lib/localRequest.ts`. Keep current loopback host handling. Accept the LAN path only when those same mode checks pass, the Server socket peer is loopback, Vite's marker equals `1`, and Origin (or same-origin Referer when Origin is absent) matches the request Host. Do not read `X-Forwarded-For` or trust any client-provided marker without the loopback proxy condition.

- [ ] **Step 2: Use the shared predicate at existing Host boundaries**

Replace duplicated loopback hostname decisions in `desktop.ts`, `workspace/index.ts`, `mobileLink/index.ts`, `suanli/http.ts`, `mcp/control.ts`, and `agent/a2a/settings.ts` with `isLocalDesktopHost`. Update the corresponding local-host logic in `routes/workspaces/selectDirectory.ts` as well. Keep endpoint-specific requirements such as `x-toonflow-desktop`, `x-toonflow-workspace`, `x-toonflow-mobile-link`, bearer tokens, and same-origin checks intact. The directory-selection route must continue to return `native: false` on Linux.

- [ ] **Step 3: Bind Server to loopback only while LAN mode is enabled**

In `apps/server/src/index.ts`, use the `127.0.0.1` listener only for the valid Linux desktop LAN development mode. Preserve the current listener behavior for all other modes. Keep the separate mobile-link listener on `0.0.0.0`, controlled by the existing user setting.

- [ ] **Step 4: Run server typecheck and build**

Run: `bun run --cwd apps/server typecheck`

Run: `bun run --cwd apps/server build`

Expected: both commands pass without changing generated route registration.

- [ ] **Step 5: Commit the server policy changes**

```bash
git add apps/server/src/lib/localRequest.ts apps/server/src/index.ts apps/server/src/lib/desktop.ts apps/server/src/utils/workspace/index.ts apps/server/src/utils/mobileLink/index.ts apps/server/src/utils/suanli/http.ts apps/server/src/utils/mcp/control.ts apps/server/src/agent/a2a/settings.ts
git commit -m "feat: allow trusted LAN desktop dev requests"
```

### Task 3: Document and verify the developer workflow

**Files:**
- Modify: `docs/development.md`

**Interfaces:**
- Consumes: the completed opt-in command and server authorization behavior from Tasks 1 and 2.
- Produces: Linux desktop LAN development instructions that state the host URL pattern, HMR behavior, default port 5173, optional device-link port 43123, and the LAN permission scope.

- [ ] **Step 1: Document opt-in usage and access scope**

Document `TOONFLOW_DEV_LAN=1 bun run dev`, opening `http://<linux-lan-ip>:5173/?desktop=1&linuxDevWorkspace=1`, and allowing TCP 5173 through the host firewall. Explain that any device in an active private interface subnet that can reach this port can manage the development workspace and desktop Host APIs while LAN mode is active. State that port 3000 remains loopback-only and device-link port 43123 is opened only when sharing is enabled.

- [ ] **Step 2: Manually verify accepted and rejected paths**

Run the stack with LAN mode from Linux. From a same-subnet browser, confirm the desktop page loads without startup error, `/api/desktop/ready` succeeds, workspace operations work, and device-link status/configuration work. Enable device sharing and pair a second LAN device through port 43123; disable sharing and confirm that listener is no longer available. From the peer, confirm direct access to port 3000 fails. Run again without the LAN flag and confirm LAN-origin desktop Host requests remain rejected while loopback development works.

- [ ] **Step 3: Commit the documentation**

```bash
git add docs/development.md
git commit -m "docs: explain Linux LAN desktop development"
```
