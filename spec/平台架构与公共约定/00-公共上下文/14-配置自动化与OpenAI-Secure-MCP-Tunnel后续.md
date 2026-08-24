# 配置自动化与 OpenAI Secure MCP Tunnel 后续

更新时间：2026-08-25

## 1. 当前状态

Real-2 已冻结：`REAL_2 = PASS`，当前阶段已进入 `REAL_3`。
本文件不重开 Real-2，只记录后续 Deployment/Setup 自动化整改候选。

当前真实 `platform status`：24 个模块中 21 READY、2 ACTION_REQUIRED、1 BLOCKED、0 FAILED。
剩余：`chatgpt-carrier`、`model-provider-api`；`model-runtime` 仅等待 model-provider-api。

## 2. 已冻结的自动化 backlog

P0：`chatgpt-carrier` 删除人工 GPT URL / capability confirmation，改为消费 Role Registry + Extension/Provisioning + Gateway 的机器真源。
P1：`model-provider-api` 审计 Provider endpoint discovery，能自动发现就不再要求人工输入 Base URL。
P1：`model-runtime` 审计 models/capability discovery，能自动探测就自动选择 FAST / REASON。
P2：`execution-runtime` 删除“人工提供 loaded Chrome Extension ID”的过时 setup 文案/合同。
P2：`execution-browser-extension` 继续保持 Extension ID、Bridge、heartbeat 自动发现；普通 Chrome 首次安装仍尊重浏览器安全边界。
## 3. dev-tunnel 替换意图

用户希望后续评估：用 OpenAI Secure MCP Tunnel 替换当前 Microsoft Dev Tunnel。
当前只做调研，不在本 Chat 实现。

已确认事实：OpenAI 官方把 Secure MCP Tunnel 定位为“把本地/私网 MCP server 连接到 OpenAI 产品，而无需暴露到公共互联网”；本机 `tunnel-client 0.0.11` 同样描述为连接 MCP server 到 OpenAI control plane 的 outbound tunnel。
`tunnel-client runtimes connect` 当前公开入口是 `--mcp-command` / `--mcp-server-url`；未发现等价于 Microsoft Dev Tunnel 的“任意本地 HTTP 服务 → 公网 HTTPS URL”合同。

因此替换前硬门：必须先真实证明 Secure MCP Tunnel 能否为当前普通 HTTP `agent-gateway` 提供 Custom GPT Actions 可消费的公网 HTTPS `servers.url`。不能只证明 MCP connector 能访问本机 MCP。

若该能力不存在：禁止强行替换 `dev-tunnel`；应明确给出 `NOT_A_GENERAL_PUBLIC_INGRESS` 结论，并评估是否需要先把 Gateway carrier 协议改成 MCP（这属于架构变更，不能在当前 Phase 3 验收中静默进行）。

## 4. 人工边界

可以继续自动：已授权后的 tunnel/runtime 发现、持久运行、health/ready、shared facts、Role/Carrier/模型配置发现。
必须保留外部授权边界：OpenAI Platform tunnel/runtime key 授权、ChatGPT 登录、普通 Chrome 首次扩展安装、第三方账号首次登录。

安全规则：不得读取、打印、提交 OpenAI API key、Admin key、Runtime key、Tunnel token 或任何 Role credential。只允许验证 secret reference、长度/存在性、权限和健康状态。
## 5. OpenAI Secure MCP Tunnel 替换任务提示词

```text
接管 ProFlow 的 Tunnel Provider 替换任务。只处理 tunnel，不处理其它自动化 backlog。

仓库：/Users/agent/Desktop/proton-workspace/repos/proflow
先读：
spec/平台架构与公共约定/00-公共上下文/13-Real2-最终冻结与Real3交接.md
spec/平台架构与公共约定/00-公共上下文/14-配置自动化与OpenAI-Secure-MCP-Tunnel后续.md

背景：当前 dev-tunnel 使用 Microsoft Dev Tunnel，为 agent-gateway 发布 publicBaseUrl；三个 Custom GPT 的 OpenAPI servers.url 指向该公网 HTTPS Gateway。用户希望改用 OpenAI Secure MCP Tunnel。

第一阶段必须先做可行性证明，禁止一上来改代码。OpenAI 官方与本机 tunnel-client 当前把 Secure MCP Tunnel 定义为连接本地/私网 MCP server 到 OpenAI control plane 的 outbound MCP tunnel；不能默认它等价于 ngrok/Microsoft Dev Tunnel。

必须真实回答：
1. Secure MCP Tunnel 能否给普通 HTTP agent-gateway 提供稳定公网 HTTPS URL？
2. 该 URL 能否直接作为 Custom GPT Actions OpenAPI servers.url，由 GPT Actions backend 正常访问？
3. 是否支持任意 HTTP path/method，还是只支持 MCP JSON-RPC/channel？
4. 能否保持现有 Agent Gateway / Custom GPT Action contract 完全不变？
5. tunnel id、runtime key、admin key、organization/workspace scope、长期 supervision、health/ready、重连和 URL 稳定性分别是什么合同？
6. 当前账号/组织所需权限和产品计划限制是什么？

验证来源优先级：OpenAI 官方文档 → 本机 tunnel-client --help/help quickstart/runtimes → 真实最小实验。不得用论坛猜测替代官方/实测。
```
```text
可行性硬门：
- 若不能得到 GPT Actions 可访问的普通公网 HTTPS Gateway URL，立即 STOP。
- 输出：OPENAI_TUNNEL_GENERAL_HTTP_INGRESS = NO，并解释为什么 Secure MCP Tunnel 不能替代当前 dev-tunnel。
- 不得为了迁就 Tunnel 擅自把 Agent Gateway / Custom GPT Actions 改成 MCP；那属于架构变更，当前任务无权静默执行。

若且仅若可行性真实 PASS：
1. 先用 CodeGraph + 源码确认 dev-tunnel 当前职责、shared facts、agent-gateway 依赖与测试 blast radius。
2. 默认保持上层合同不变：仍向 agent-gateway 发布 `publicBaseUrl`；不要无必要改 Agent Package / Gateway OpenAPI / Real-2 角色逻辑。
3. 优先最小替换底层 provider；是否保留 moduleRef `dev-tunnel` 或改名必须基于实际 blast radius决定，不为命名做全仓重构。
4. 先更新对应规范/SETUP/Test Plan，再 TDD/targeted tests，再实现。
5. 长期运行优先 `tunnel-client runtimes connect`，完成后必须以 `runtimes status --json` + `/healthz` + `/readyz` 判断真实状态；禁止 nohup/disown。
6. 配置只保存 tunnel id、secret reference、health/shared facts；不得把 Runtime/Admin/API key 明文写入 repo、日志、evidence 或普通 config。
7. 不 publish，不改 Registry，不进入其它 Real 阶段，不顺手处理 chatgpt-carrier/model-runtime 自动化。

安全：绝不读取/打印 OPENAI_ADMIN_KEY、CONTROL_PLANE_API_KEY、Tunnel token、Role credential。若 secret 已存在，只验证引用、文件权限、存在性和命令返回的非敏感状态。

最终必须给用户一个明确裁决：
A. NOT_COMPATIBLE：不能替代，代码零修改；
或
B. COMPATIBLE_AND_REPLACED：普通 Agent Gateway contract 不变，OpenAI Tunnel 实现替换完成，targeted tests + real gateway ingress probe PASS。

不要猜，不要因为名字里有 Tunnel 就认为它是通用内网穿透。
```
