---
docId: TP-MODULE-DEV-TUNNEL
title: dev-tunnel｜自动部署收口 Module Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
boundedContext: deployment-governance
moduleRef: dev-tunnel
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceRefs:
- DEPLOYMENT-DOC-04
- AGENT-AGENT-GATEWAY-TECH-DESIGN
implementationWave: Real-3 setup automation
---

# `dev-tunnel` 自动部署收口 Test Plan

## 1. 范围与不变量

本计划只验证 Microsoft Dev Tunnel 的自动 setup。`dev-tunnel` 继续提供
`public-ingress`；`agent-gateway` 继续拥有本地 HTTP endpoint 和 Custom GPT
Actions transport，并消费 `public-ingress`。不引入 MCP，不改变 Real-2。

```text
DEV_TUNNEL_USER_CONFIG = 0
ONLY_HUMAN_ACTION = GitHub browser authorization when login is required
```

## 2. Golden Path

```text
user show --json
→ 必要时 user login --github --use-browser-auth
→ 再次 user show --json
→ workspace tunnelId 远端 show 验证或 create --allow-anonymous --json
→ 读取 agent-gateway producer-owned localBaseUrl
→ port list/create/update --json 幂等对齐
→ host persistent Tunnel
→ 按当前 Gateway port 精确发现 HTTPS forwarding URI
→ 验证 TLS 1.2+ 与 HTTPS 可达
→ 持久化 tunnelId/publicBaseUrl 并发布 shared facts
→ READY
```

不得从账户 Tunnel 列表随机接管资源，不得要求用户输入 Tunnel ID、端口或 URL。

## 3. Required Proofs

- **CP-DEV-TUNNEL-01 Login**：有效登录直接复用；缺失登录只执行 GitHub browser auth，成功后在同一次 setup 继续；取消、失败、超时或 UNKNOWN 均 fail closed。
- **CP-DEV-TUNNEL-02 Identity**：仅复用当前 workspace 持久化且经远端 `show --json` 验证的 Tunnel；无 state 或远端丢失时自动创建并重新绑定。
- **CP-DEV-TUNNEL-03 Gateway endpoint**：端口只来自 `agent-gateway` 发布的 `localBaseUrl`，不得 hardcode、扫描或让用户输入。
- **CP-DEV-TUNNEL-04 Port**：当前端口映射正确时 no-op；缺失时 create；协议 drift 时 bounded update；失败不得写 READY。
- **CP-DEV-TUNNEL-05 URL**：只接受当前 Gateway port 对应的 `portForwardingUris` HTTPS URL；多端口不得取第一个；缺失、畸形、非 HTTPS fail closed。
- **CP-DEV-TUNNEL-06 Idempotency**：重复 setup 不重新登录、不重复创建 Tunnel/port，持久 state 稳定。
- **CP-DEV-TUNNEL-07 Runtime**：owned host 复用，UNKNOWN 不盲目重放，stop 保持安全语义。
- **CP-DEV-TUNNEL-08 Security/Contract**：setup state 只含非敏感 `tunnelId/publicBaseUrl`；不读取、输出、持久化 token；七命令、`public-ingress` 和零 configSlots 不变。

## 4. Test Layers

| Layer | Requirement |
|---|---|
| Unit / fixture | REQUIRED；覆盖 JSON boundary、登录、Tunnel、port、URL、失败与幂等 |
| Module integration | REQUIRED；覆盖 shared facts、state 与 single-call setup composition |
| Process lifecycle | REQUIRED；覆盖 owned PID、UNKNOWN、start/stop |
| Real external E2E | REQUIRED FOR FINAL ACCEPTANCE；真实 create/port/host/login/probe 不得由 mock 冒充 |
| Security / boundary | REQUIRED；证明无 secret persistence/output 与 owner 边界不变 |

## 5. RED / GREEN Gate

先以 command-runner、fake runtime 和临时 workspace 写出上述 proof，观察行为缺失导致的
RED；再做最小实现并转 GREEN。真实 Dev Tunnel mutation 不在单元测试中执行。若 CLI JSON
现实无法支持当前端口对应 URL 的可靠发现，停止并报告 blocker，不回退人工输入。
