# CURRENT｜Phase 3 当前接力

> 更新时间：2026-09-03。这里是下一 Chat 的唯一滚动执行入口；旧 handoff 只在 `90-历史记录`。

## CURRENT_STAGE

```text
ARCHITECTURE = FROZEN
REAL_1 = PASS
REAL_2 = PASS / FROZEN
DEPLOYMENT_SUCCESS = YES / FROZEN
CONTEXT_GOVERNANCE = PASS / FROZEN
CONTEXT_KNOWLEDGE_MIGRATION_AUDIT = PASS
CURRENT_EXECUTION_GATE = REAL_3_J0_J4
PHASE3_FINAL_GO = NO
```

## FINAL_GOAL

完成 Real-3 J0→J4 的真实“人工视角自动化”功能验收。当前穿插的包更新/Dev Tunnel 恢复只是 Real-3 前置修复循环，不代表重开 Deployment。

## LAST_COMPLETED

- 公共上下文可执行知识迁移交叉审计完成：五项迁移门 13/13 领域 PASS；失忆新 Chat 执行模拟 10/10 PASS；活跃知识库具体 `0.1.x` 版本实例泄漏 = 0；旧顶层完整路径悬空引用 = 0。审计记录：`90-历史记录/上下文治理交叉审计-20260902.md`。
- Real-3 候选包已真实发布：`platform-cli@0.1.51`、`execution-browser-extension@0.1.26`、`platform-host@0.1.15`、`task-orchestration@0.1.10`。
- Browser Extension 0.1.26 已在真实 Product Workspace 物化；真实 Remove → confirm → Load unpacked → pairing/heartbeat PASS。
- Dev Tunnel `--version` 挂死根因已在 `0.1.26` 闭环；expired-token timeout evidence 缺口已在本轮完成最小修复：primary timeout 后先消费已有 stdout/stderr 证据，仍 UNKNOWN 才进入 bounded verbose fallback；timeout runner 保留 partial stderr。
- Dev Tunnel 本轮 gate = **39/39 tests PASS + typecheck PASS + build PASS**。
- `@tomflow/proflow-dev-tunnel@0.1.28` 已真实 publish；Registry exact HTTP readback = 200 / version 0.1.28。
- Product Workspace 已通过公开 `platform update --package @tomflow/proflow-dev-tunnel` 完成真实 `0.1.27 → 0.1.28`；installed version 已机械回读为 0.1.28，部署 dist 已确认包含本轮修复。
- `platform update` N→N+1 主路径已再次真实复用；不要再为日常修复 Fresh + 全量 install，也不要为当前主线重复 same-version 幂等测试。

## CURRENT_BLOCKER

Dev Tunnel 登录确认问题已经真实闭环并物化到 Product Workspace。后续 `platform setup` 已跨过登录阶段、复用 authenticated state，说明旧 auth blocker CLOSED。

当前出现过一次 `devtunnel port list --json failed or timed out`，但同一 stable tunnel 的一次只读 authority readback 随后 exit=0、约 20.147s 返回，JSON PASS，port 41705 / protocol=http 仍存在。该现象与 Deployment Final Freeze 中已出现并被用户裁决 `NOT_BLOCKER` 的单次 port-list failure 同类；当前没有证据支持端口被回收、45s timeout 稳定不足或新的 owning-package defect。

裁决：**不扩 timeout、不发新的 dev-tunnel 版本、不重开 Deployment**。当前只做 Real-3 环境恢复：复用已有 stable tunnel/port，恢复 host/public forwarding；若产品正常恢复则直接进入 lifecycle/J0→J4。只有同场景再次可复现并取得确定性 authority evidence，才允许升级为新 blocker。

Browser 工具链已完成真实恢复验收。后续 Browser 自动化继续按 `act → Playwright observe → authority readback → next`；不要重新安装扩展、不要重启 Chrome、不要回旧 9229 CDP。

## DO_NOT_REPEAT

- 不重新 Fresh Workspace、不重新 `platform install`。
- 不重新折腾 Browser Extension；Browser 0.1.26 已真实 PASS。
- 不重新调查 `--version`；该问题已在 dev-tunnel 0.1.26 修复。
- `UNKNOWN != NOT_LOGGED_IN`；UNKNOWN 不盲重试、不无条件强制 GitHub 登录。
- 不继续发散 `user show --help`、`list --json` 等随机探针；先读 Dev Tunnel Runbook 和历史既有裁决。
- 不因为当前碰到 setup/tunnel 就重开 Deployment 或大改稳定 install/setup/status。
- 不再把 `connect.html` 本身当失败信号。正确 token + runtime restart 后，首次调用出现一个 `connect.html` 且自动显示 `Playwright MCP connected.` 是正常 bootstrap；业务可控性继续以 `browser_tabs + snapshot/screenshot` 为准。不要重复 restart/reconnect，除非真实 runtime evidence 证明连接已重建/失效。
- 当前模型 endpoint 因用户占用设备可能不可达：`IGNORE_FOR_NOW / NOT_PRODUCT_BUG`，不要重新设计模型域。

## NEXT_ACTION

1. 不再处理 port-list timeout。复用当前 Product Workspace 的 stable tunnel/port，通过产品公开生命周期恢复 host/public forwarding；优先从 `platform status` / `platform start` / 必要时同场景 `platform setup` 恢复，不做 Fresh/install，不直接写状态。
2. 恢复成功后验证 `platform start` 返回 shell → `platform status` → `platform stop` → 再次 start/status。
3. lifecycle 闭环后加载 `流程/Real3-J0-J4.md`，从 J0 checkpoint 连续推进。
4. Browser 相关操作继续执行 `act → Playwright observe → authority readback → next`；需要控制页面时先确保它在 Playwright 受控标签组中。
5. 若 Real-3 再发现真实 owning-package 缺陷，只有取得可复现 authority evidence 后才插入 `Package-Update-Loop`，修复后返回原 Journey checkpoint。

## REQUIRED_CONTEXT

本轮接手必须加载：

1. `01-长期规则/01-总控职责与阶段门禁.md`
2. `01-长期规则/05-执行纪律与工具规则.md`
3. `03-自动化知识库/基础动作/CLI-PTY交互自动化.md`
4. `03-自动化知识库/基础动作/Tool-Runtime-gptweb-mcp.md`
5. `03-自动化知识库/基础动作/Browser-UI自动化.md`
6. `03-自动化知识库/包能力/dev-tunnel.md`
7. Dev Tunnel/setup 恢复后加载 `03-自动化知识库/流程/Real3-J0-J4.md`

`Package-Update-Loop` 不再是当前必读：0.1.28 已发布/update 完成；只有后续出现新的真实 owning-package bug 时再按 Routing Index 加载。若产品 Browser Extension 本身出现新 regression 才加载 `包能力/execution-browser-extension.md`；不要把 Playwright 工具连接问题误判成产品扩展问题，也不要预防性重测 Browser。

## REAL_3 RECOVERY TARGET

Dev Tunnel/Setup 恢复后：

```text
platform setup → 目标 3/3
platform start → 必须归还 shell
platform status
platform stop
→ J0 → J1 → J2 → J3 → J4
```

最终 Truth：真实 npm 包 + 真实 Product Workspace + 真实 Browser 用户消息结构 + Owner Facts。`REAL_3=PASS` 只能由完整真实 evidence 裁决。
