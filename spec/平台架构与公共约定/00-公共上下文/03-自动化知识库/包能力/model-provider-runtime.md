# Runbook｜Model Provider / Runtime

> 模型域固定只认 OpenAI-compatible URL、FAST、THINK/REASON 和能力探针；禁止重新引入设备/厂商发现。

## 用户视角

用户只提供机器无法自动推导的 OpenAI-compatible Base URL，以及必要 secret。正常流程不要求用户理解 provider module、inventory、modelRef、shared facts，也不要求按模型拆 URL。

机器自动完成：

```text
Base URL
→ inventory (/v1/models 或兼容路径)
→ 真实 capability probe
→ FAST / THINK(REASON) 映射
→ Vision / thinking 等能力事实
→ READY
```

`platform setup` 的 CLI/PTTY 交互、输入恢复和 Acceptance mechanics 直接服从 `/Users/agent/Desktop/proton-workspace/skills/chat-local-acceptance-automation-protocol/SKILL.md`；本 Runbook 只定义 Provider/Runtime 产品事实、READY 条件与 fail-closed 边界。

多个已合格候选且无法唯一决策时才询问用户。URL / inventory / probe UNKNOWN 时 fail closed。

## Authority / READY 真值

Provider 当前真值不是旧 setup 文件本身：`model-provider-api` 的 `status` 会基于已绑定 Base URL/credential **重新执行真实 OpenAI-compatible provider probe**；只有 live probe 返回 READY 才报告 `setupStatus=READY` 并把 observation/shared facts 作为已验证 Provider facts。旧 observation 只能作为配置输入/恢复材料，不能覆盖 live probe 失败。

Runtime 当前能力真值以正式 `getRuntimeStatus()` / service readiness 为准；FAST/REASON 必须都处于 READY，必要时先 `refreshCapabilities()`，刷新失败保持 fail-closed。Provider inventory/shared facts 与 Runtime mapping/status 必须一致；不能只因本地 mapping 文件存在就判模型 READY。

因此自动化验收优先走公开 `platform status`/正式 runtime status，再在需要诊断时读取 Provider observation/shared facts；不要从聊天 UI、旧日志或某个配置 JSON 猜模型状态。

## 冻结边界

禁止重新引入 MLXHub、Bonjour/mDNS、iPhone identity、Ollama、LM Studio、vLLM、llama.cpp 等设备/厂商发现概念。Provider 只管理 URL + secretRef + inventory；Runtime 只管理 FAST/REASON/Vision/thinking 等能力。

固定 TTL 已移除；inventory 变化触发 stale/remap。不得 Fake READY。

## 自动化恢复

已有有效 Provider/FAST/THINK 配置时直接复用，不为了跑其它流程重复 setup。真实 endpoint 临时不可达时先区分外部环境与产品 regression；只有产品应保证的场景出现可复现失败才进入 package repair。

具体某次 endpoint 暂不可达、用户设备占用、当前 Base URL 等会变化的现场事实只写 `02-当前接力/CURRENT.md`，不得固化在本 Runbook。Runbook 只保留判定原则：已知外部环境不可用不自动升级为产品 bug。

若模型包真实出现问题：定位 provider/runtime owning package → `流程/Package-Update-Loop.md` → update → 回原 Journey checkpoint。
