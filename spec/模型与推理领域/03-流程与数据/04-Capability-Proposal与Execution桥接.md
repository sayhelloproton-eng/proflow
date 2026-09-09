---
docId: MODEL-DOC-03-04
title: 08 · Internal Effect Proposal 与 Execution 桥接
docType: cross-domain-flow
authority: normative
lifecycle: active
domain: model-reasoning
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 08 · Internal Effect Proposal 与 Execution 桥接

## 1. Scope

本文只描述**平台内部模型推理**如何为需要 durable Execution 的风险/诊断场景提出结构化候选；它不描述 Custom GPT Tools。

Custom GPT 已原生通过静态 Actions 使用 Task/Peer/Repomix/Local Dev/CodeGraph。GPT Local Tools 不进入本文件的 Proposal→Execution bridge。

## 2. Internal path

```text
internal caller prepares bounded candidates
→ Model Runtime + Reasoning Spec
→ model returns one structured proposal/finding
→ caller validates schema/allowlist/hard scope
→ Execution internal Policy/Approval（确需 durable effect 时）
→ durable Browser/Carrier/materialization effect
→ typed Result/Evidence
```

## 3. Model limits

模型不能：

- 发明未提供的 internal capability；
- 携带 credential/secret；
- 覆盖 hard scope / DENY / mandatory Approval；
- 声称 effect 已执行；
- 获得自主无限 Tool Loop。

## 4. 与 Custom GPT Actions 分层

```text
Custom GPT Action selection
→ Gateway → Owner API / Browser Extension Local Tool lane

Internal Model proposal
→ caller validates
→ optional durable Execution
```

两者不能互相替代。尤其禁止因为内部仍保留 Execution capability contract，就重新给 GPT 暴露 `executeCapability/getExecution/readExecutionOutput`。

## 5. Result / rounds

内部 proposal/result 必须 bounded、typed、secret-redacted；caller 自己控制有限 `maxRounds`，达到上限 STOP/ESCALATE/return unresolved。
