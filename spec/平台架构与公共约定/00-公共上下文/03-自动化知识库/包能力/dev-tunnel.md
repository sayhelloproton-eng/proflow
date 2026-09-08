# Runbook｜Dev Tunnel

> Owner：`@tomflow/proflow-dev-tunnel`。任何流程碰到 login / Tunnel / port / publicBaseUrl / TLS，先读本文，禁止重新发明路径。

## 用户视角

普通用户只使用 `platform setup` / `platform status` / `platform start` / `platform stop`。不得要求用户手填 Tunnel ID、port、public URL，也不得把 `devtunnel user/show/list/create/port/host` 变成正常用户步骤。

后台诊断可以使用 managed CLI 观察真实状态，但自动化不能靠直接写 `.proflow` 或 remote state 绕过产品流程。

## CLI ownership

- Dev Tunnel CLI 由本包直接治理，独立 `@tomflow/proflow-devtunnel-cli` 已退休/deprecated。
- 固定 Microsoft Dev Tunnel CLI `1.0.2030`，按 platform/arch 从官方 artifact 获取。
- package-local resolver 是唯一执行入口；禁止回退 PATH system `devtunnel`。
- acquisition 必须验证 pinned version metadata + artifact SHA-256 + actual binary SHA-256。
- 2026-09-02 已证实该 CLI 的 `--version` 在真实机器可挂死；**禁止再把 `--version` 当 runtime version probe**。

## Login 真值与恢复

正常第一真值：`devtunnel user show --json`。该调用必须使用**足以覆盖真实 CLI 延迟的 bounded timeout**；不要把历史短窗口写死成知识规则。真实现场已证明该命令可稳定超过 10s 后才返回确定状态。

固定判定：

```text
JSON = LOGGED_IN      → 直接继续，零浏览器动作
JSON = NOT_LOGGED_IN  → 一次真实 GitHub Browser Auth → 再确认 LOGGED_IN
JSON timeout/null     → **先消费 primary 已返回的 stdout/stderr evidence**
  primary JSON/text 已明确 expired / logged-in → 直接按证据判定，不重复探测
  primary 仍 UNKNOWN → 8s verbose diagnostic
    明确 expired / not logged / login required → NOT_LOGGED_IN
    其它                                → UNKNOWN → STOP
```

`UNKNOWN != NOT_LOGGED_IN`。禁止因为 timeout 自动登录、创建 Tunnel 或继续 mutation。

真实证据已证明：同一 managed CLI 的 `user show --json` 响应时延可能明显波动并超过 bounded timeout，但 partial stdout/stderr 仍可能已经明确给出 `Login token expired`；verbose 也可能明确打印 cached GitHub access token expired。因此“timeout 后直接丢 primary evidence 去第二次探测”不可靠。稳定合同是：**bounded timeout 只改变完成状态，不得抹掉已经获得的确定性 evidence；先消费 evidence，再决定是否 fallback。** timeout runner 也必须保留 partial stdout/stderr。具体历史版本归 CURRENT/历史。

认证只允许一次真实登录事务；账号本人授权、2FA、CAPTCHA 等不可替代动作交给用户。登录完成后必须由产品流程再次确认 `LOGGED_IN`。

需要观察/操作 GitHub Browser Auth 时，先加载 `基础动作/Tool-Runtime-gptweb-mcp.md` + `基础动作/Browser-UI自动化.md`，**复用当前真实 Chrome 的 Playwright 控制链**。Playwright `connect.html` 不是 GitHub Auth；若它意外出现，先恢复工具 runtime，不重新启动 `platform setup`，也不把工具连接页当 Tunnel blocker。


## 高成本 Start 前 Remote Reality Gate

本地 `setup.json.phase=READY` 只表示 Tunnel ID / Gateway port / publicBaseUrl 曾经持久配置成功，**不等于当前 remote login、Tunnel、port 仍然有效**。只要要消费高成本/限次的真实 `platform start`，且 dev-tunnel 当前 `runtimeStatus=FAILED/UNKNOWN/STOPPED`，先做只读 remote preflight。以下 `devtunnel` 只表示命令语义，真实执行仍必须走本包 package-managed CLI / resolver，**不授权 PATH system binary**：

```text
devtunnel user show --json
→ 登录 authority

devtunnel show <persisted tunnelId> --json
→ Tunnel existence authority

devtunnel port list <persisted tunnelId> --json
→ exact Gateway port existence/protocol authority
```

固定裁决：

- `AUTH_EXPIRED / NOT_LOGGED_IN`：先恢复一次 canonical 登录事务；**start count 保持 0**。
- 登录未恢复前，`show/port list` 的失败不能推导 `TUNNEL_MISSING / PORT_MISSING`。
- `show = EXISTS` 才继续 exact port readback；只有明确 `MISSING` 才进入 stable identity 的既有恢复路径。
- exact port 只有明确缺失或协议漂移才允许 reconcile；timeout/UNKNOWN 不做 remote mutation。
- Login + Tunnel + exact port 三层 remote reality 均明确后，才允许消费被单独冻结的 production start。

这条 Gate 的目标是防止“本地 READY + 远端认证/资源已失效”浪费一次真实 start；它不把内部 `devtunnel` 命令变成普通用户日常步骤，后台诊断仍由 owning package/总控机械执行。

## Login 诊断语义与 Start 前 fail-closed

2026-09-08 已完成 owning package 源码修复与 package mechanical gate：login probe 现在保留 `LOGGED_IN / AUTH_EXPIRED / NOT_LOGGED_IN / QUERY_TIMEOUT / CLI_ERROR / UNKNOWN` 分类；非零 exit + `Login token expired` 不再被压成 `UNKNOWN`。

配置已 READY 但 host 不在时，Deployment `status` 才额外读取 login authority：

```text
AUTH_EXPIRED / NOT_LOGGED_IN
→ setupStatus=ACTION_REQUIRED
→ TUNNEL_AUTH_EXPIRED / TUNNEL_LOGIN_REQUIRED
→ platform setup --module dev-tunnel

QUERY_TIMEOUT / CLI_ERROR
→ setupStatus=BLOCKED
→ TUNNEL_LOGIN_QUERY_TIMEOUT / TUNNEL_LOGIN_CHECK_FAILED
→ fail-closed，不消费 production start

LOGGED_IN + host absent
→ setupStatus=READY
→ 允许正式 start 恢复 runtime
```

`DevTunnelRuntime.status()` 仍保持 local-process-only，不把远端 CLI 查询塞进底层 process status；remote login diagnosis 由 Deployment status 在“configured + runtime not running”这个需要决策的边界负责。直接 module start 若绕过 preflight，仍以标准 `START_FAILED` 合同返回，但 message 保留 `AUTH_EXPIRED / NOT_LOGGED_IN / QUERY_TIMEOUT / CLI_ERROR` 分类。

机械 Gate：dev-tunnel `42/42 tests PASS + typecheck PASS + Biome PASS + git diff --check PASS`。**当前只证明仓库源码候选；Registry / Product Workspace / 真实 expired-token same-scene adoption 仍待后续 release/update 验证。**

## Tunnel ownership / Fresh recovery

remote identity 固定由 canonical workspaceRoot 派生：`proflow-${sha256(resolve(workspaceRoot)).slice(0,24)}`。

- 有本地 state：先 show previous tunnelId；`EXISTS` 复用，`MISSING` 才走稳定 identity 恢复，`UNKNOWN` STOP。
- 无本地 state：先 show stableTunnelId；`EXISTS` 重建本地状态，`MISSING` 才 create exact stable ID，`UNKNOWN` STOP。
- Fresh 删除 `.proflow` **不得**导致随机创建第二条远端 Tunnel。

## Mutation durability

Create 是 non-idempotent remote mutation：目标 stable tunnelId 必须在 mutation 前已知。create 返回后先原子写 `PENDING_CREATED`，再 show 验证。create timeout/UNKNOWN 禁止盲重试；下一轮围绕同一 stable ID 恢复 remote truth。

Port 只 reconcile 当前 Gateway exact port：

- 已存在且 protocol=http → REUSE
- 缺失 / No ports found → CREATE
- 同端口协议漂移 → 只删除 exact port 后重建
- 其它 ports 不碰
- `port list --json` 单次 timeout/failure **不自动升级为产品缺陷**。先对同一 stable tunnel 做一次 bounded、只读 authority readback；若随后能正常返回且端口仍存在，则按上游瞬时异常处理，不扩 timeout、不发新版本、不重开 Deployment。只有同场景可复现，或 authority 返回确定性结构/协议错误，才进入 owning-package 修复循环。

Host：已确认 RUNNING 不重复 host；STOPPED/新 Tunnel 才启动；remote/local UNKNOWN 且不能证明安全时 STOP。setup 同事务完成登录后应复用 `loginVerified`，避免 host.start 再做一遍 user show。

## Public URL / READY

只接受当前 Gateway exact port 的 HTTPS forwarding URI。host 后 eventual consistency 最多 bounded 3 轮 show；随后真实验证 HTTPS:443、TLS >=1.2 且可达。全部成立才允许 `phase=READY` 并发布 shared facts `tunnelId/publicBaseUrl`。

无 Bearer 请求得到 Gateway `401 / AUTHENTICATION_FAILED` 可作为“公网 Tunnel 已真实到达 Gateway auth boundary”的正向 evidence。

## 自动化恢复纪律

一次启动真实 `platform setup` PTY 后沿同一事务走，不在每阶段预跑 devtunnel。Browser Auth 拉起后继续当前 auth，不重新启动 setup。timeout/UNKNOWN 保存 setup/state/process/browser evidence，再恢复权威状态。

若 source / Registry / Product Workspace 的目标包版本或物化内容不一致：走 `流程/Package-Update-Loop.md`，不要 Fresh/install。发布状态 UNKNOWN 时先 Registry exact readback，禁止盲 publish。
