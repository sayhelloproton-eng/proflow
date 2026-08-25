# 配置自动化与 OpenAI Secure MCP Tunnel 后续

更新时间：2026-08-25

## 1. 当前状态

Real-2 已冻结：`REAL_2 = PASS`，当前阶段已进入 `REAL_3`。
本文件不重开 Real-2，只记录后续 Deployment/Setup 自动化整改候选。

父工作区当前 `platform status` 仍来自未重新发布/安装的旧 Registry 包，因此仍可能显示 `chatgpt-carrier ACTION_REQUIRED`。源码侧 `chatgpt-carrier` 自动观察已经 PASS；在统一 release/install 前，不得把旧安装物状态误判为源码回归，也不得为了让状态变绿而篡改安装物。

## 2. 配置自动化 backlog 当前状态

P0 `chatgpt-carrier`：`DONE`。已删除人工 GPT URL / capability confirmation；Deployment 仅机器观察 ChatGPT Web 外部可用性，不再维护第二份 Role/Auth/Capability truth。提交：`f81b77b`、`e798db4`。

P1 `model-provider-api`：`BOUNDARY_CONFIRMED`。当前没有正式 mDNS / Bonjour / producer-owned discovery；`providerBaseUrl` 暂时属于真正外部部署输入，禁止从历史 LAN IP 或盲扫局域网猜测。

P1 `model-runtime`：`DEFER_TO_MODEL_DOMAIN`。`/models` 可发现候选，但当前 deployment `profiles()` 仍缺 producer-owned capability profile；FAST/REASON 又明确不得按模型名或固定 ID 猜测。应在模型领域以真实 bounded capability probe 闭环后再自动选型。

P2 `execution-runtime`：`PENDING_SMALL_CLEANUP`。删除“人工提供 loaded Chrome Extension ID”的过时 setup 文案/合同；Extension ID 已由 hello/pairing/heartbeat 机器发现。

P2 `execution-browser-extension`：保持 Extension ID / Bridge / heartbeat 自动发现；普通 Chrome 首次安装仍尊重浏览器安全边界。
## 3. dev-tunnel 替换意图与当前裁决状态

用户希望评估：用 OpenAI Secure MCP Tunnel 替换当前 Microsoft Dev Tunnel。当前只做调研，不在本 Chat 实现。

第一次独立调研给出：`A. NOT_COMPATIBLE`、`OPENAI_TUNNEL_GENERAL_HTTP_INGRESS=NO`、`OPENAI_TUNNEL_GPT_ACTIONS_COMPATIBLE=NO`、源码零修改。核心解释是 Secure MCP Tunnel 暴露的是 OpenAI 产品到私有 MCP Server 的受控 MCP 通道，而非 GPT Actions 可直接填写 `servers.url` 的通用公网 HTTPS reverse proxy。

但该结论**尚未冻结**。用户随后明确提出“既然都是 Tunnel，再重新调研一次”，因此当前正式状态为：

```text
TUNNEL_FIRST_REVIEW = NOT_COMPATIBLE
TUNNEL_FIRST_REVIEW_FROZEN = NO
TUNNEL_SECOND_REVIEW_REQUIRED = YES
SOURCE_CODE_MODIFICATIONS = 0
```

第二轮必须独立复核，不得把第一轮结论当作前提；重点调查 OpenAI 官方最新 Secure MCP Tunnel、Harpoon/advanced mode、HTTP MCP transport、hosted tunnel endpoint、developer mode/app integration 等是否存在能让**普通 Agent Gateway HTTP contract 原样工作**的入口。只有再次证明不存在，才可冻结 NOT_COMPATIBLE。

## 4. 人工边界

可以继续自动：已授权后的 tunnel/runtime 发现、持久运行、health/ready、shared facts、Role/Carrier/模型配置发现。
必须保留外部授权边界：OpenAI Platform tunnel/runtime key 授权、ChatGPT 登录、普通 Chrome 首次扩展安装、第三方账号首次登录。

安全规则：不得读取、打印、提交 OpenAI API key、Admin key、Runtime key、Tunnel token 或任何 Role credential。只允许验证 secret reference、长度/存在性、权限和健康状态。

## 5. Tunnel 独立任务流转

本文件只维护自动化 backlog、Tunnel 调研状态和边界，不再复制完整执行提示词。

最新 Tunnel 二次独立调研提示词与当前总上下文统一维护在：
`15-当前上下文与Tunnel任务流转-20260825.md`。

后续 Chat 只读取 `13 + 14 + 15`，不得恢复已删除的重复 `16` 交接文件。
