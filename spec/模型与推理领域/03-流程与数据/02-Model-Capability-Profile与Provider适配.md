---
docId: MODEL-DOC-03-02
title: 05 · Model Capability Profile 与 Provider 适配
docType: provider-adapter
authority: normative
lifecycle: active
domain: model-reasoning
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 05 · Model Capability Profile 与 Provider 适配

## 1. [FROZEN] 逻辑角色与物理模型解耦

```text
FAST   ≠ 某个固定 model id
REASON ≠ 某个固定 model id
```

FAST/REASON 是平台逻辑算力角色。

Deployment 把逻辑角色映射到某个 API 模型；Model Runtime 用 Capability Profile 判断该映射是否满足调用需求。

## 2. [FROZEN] 最小 Capability Profile

概念：

```ts
interface ModelCapabilityProfile {
  modelRef: string;
  reasoningModes: readonly ("thinking" | "no-thinking")[];
  inputModalities: readonly ("text" | "image")[];
  structuredOutput: "native" | "prompted" | "unsupported";
  contextWindow: number;
  maxOutputTokens: number;
}
```

v1 不扩展成动态能力图谱。

## 3. [FROZEN] 稳定性硬约束

以下不是装饰 metadata：

- thinking/no-thinking；
- text/image；
- structured output；
- context/output limits。

调用要求与 Profile 不匹配：

```text
CAPABILITY_UNSUPPORTED
```

禁止静默：

- 丢图片；
- 以 FAST 替 REASON；
- 以 REASON 替 FAST；
- 超 context 仍请求；
- structured output unsupported 却进入控制链。

## 4. API Provider Adapter

Adapter 知道具体：

```text
provider API protocol
base URL
credentialRef
model id
provider-specific reasoning flags
provider-specific image encoding
```

但这些不进入公共跨领域合同。

## 5. [FROZEN] Tool Calling 能力不进入 Profile

v1 不依赖原生 Tool Calling，因此 Profile 不需要 `supportsTools` 之类字段作为平台稳定性条件。

工具相关行为通过 Capability Proposal 规范解决。

## 6. [FROZEN] 配置与验证分离

“声明支持”不等于“验证通过”。

Deployment 配置 Profile，M2/doctor 使用真实 API 验证：

- text；
- reasoning mode；
- structured output；
- Vision（如声明）。

不合格角色为 `UNAVAILABLE`。

## 7. [DEFERRED] 第二 Provider 抽象

只有出现第二套真实 Provider 接入代码并证明存在重复后，才考虑抽出更细 Adapter/package。v1 不预设计 plugin lifecycle。

## 8. 2026-08-25 部署自动化实现对齐

本节把 §1、§3、§6 的冻结规则映射到部署实现，不改变 Capability Profile 或跨领域 Contract：

- Model Provider 只消费 Deployment composition 提供的 generic HTTP(S) endpoint 与可选 credential reference，不拥有 Bonjour/DNS-SD、设备或产品识别。自动 endpoint resolver 的 Deployment owner 未冻结时必须停在架构门，不得将 discovery 偷塞到 Model，也不得要求用户手填机器可发现的 IP/Base URL。
- READY 必须来自真实 `/v1/models` 或 `/models` inventory 协议验证及认证结果，不能来自 TCP/HTTP 可达性或静态模型清单。
- Model Runtime 必须先逐候选实测 text、reasoning mode、structured output 与 Vision，再建立 FAST/REASON 映射；模型名只允许作为证据合格后的次级消歧信号。
- FAST/REASON 映射及其 evidence、inventory fingerprint、验证时间必须持久化；inventory 漂移或 evidence 过期先降为 stale，再重新验证。
- 多个证据合格候选仍歧义时，只允许用户在该集合内选择；人工选择不能绕过 §3 稳定性硬约束。
- Provider 离线、缺少任一角色、验证超时或协议/认证失败时不得报告 READY。
