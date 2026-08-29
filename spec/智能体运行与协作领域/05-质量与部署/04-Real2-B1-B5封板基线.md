---
docId: AGENT-DOC-05-04
title: Real-2｜B1～B5 封板基线
docType: quality-gate
authority: normative
lifecycle: superseded
domain: agent-runtime-collaboration
---

# Real-2｜B1～B5 封板基线

> **SUPERSEDED QUALITY GATE**：本文仅保留 B1～B5 当时的 primitive 封板事实。最终 Real-2 Golden Path 已在后续收敛为 Auth-before-Create、ZIP 本体上传与 `saveCurrentRole` activation rollback；当前合同以 `REAL2-Custom-GPT-Deployment-Provisioning.md` 为准，Real-2 当前冻结结论见公共上下文 `09-Real3当前上下文与未解决问题-20260829.md`。

封板日期：2026-08-24。基线 HEAD：`e5da6d28b357`。

本文件只冻结 B1～B5 已实现并已有可执行证据的能力，不替代 `REAL2-Custom-GPT-Deployment-Provisioning` 测试计划，也不提前宣告 `REAL2_PROVISIONING_GO = YES`。

## 1. 冻结范围

B1～B5 冻结以下链路：

```text
Agent Package versioned provisioning material
→ Knowledge ZIP secure staging + authenticated one-time relay
→ deployment-only /gpts/editor/* provisioning transport/driver
→ deterministic draft materialization + private create/promote + real g-id
→ Agent Domain registerRole + owner-generated role credential
→ ephemeral FINALIZE_CUSTOM_GPT_AUTH
→ owner inspect + Gateway authenticated probe
```

同时冻结：三个 Agent 对 `custom-gpt-web-provisioning` 的 machine dependency、Provisioning 与 runtime `/g/*` 隔离、Role credential ownership 与 no-secret-sink 约束。

## 2. 封板证据

B5 收官已取得：

```text
agent-product                    11/11 PASS
agent-controller-dev             14/14 PASS
agent-test-ops                   13/13 PASS
execution-browser-extension      81/81 PASS
three Agent package typecheck    PASS
root pnpm build                  PASS
Architecture Conformance         PASS
Deployment Graph                 PASS (24 modules / 23 edges)
Role credential sensitive sink   NO MATCH
git diff --check                 PASS
```

文档交叉审计已完成规范、公开 DOCS/SETUP、Role/identity、Knowledge、Provisioning/Auth terminology 的减法；测试计划与现有 executable tests 保持不改。

## 3. 明确未封板的 B6 范围

当前三个 Agent `deployment/adapter.ts` 的 `Module.setup` 仍以 durable Role observation 为主，MISSING/DRIFT 时返回旧 `ACTION_REQUIRED` setup plan；它尚未把上述 primitives 串成最终自动闭环。

因此以下内容明确属于 B6，不能被 B1～B5 GREEN 替代：

```text
Module.setup → provisionPackage → live g-id
→ registerRole → finalize auth → validate 的正式集成
setup retry / interruption / extension reload recovery
existing live GPT UPDATE/verify 与 no-duplicate proof
Fresh Workspace 真实三个 Private GPT
Knowledge processing/readback、真实 Gateway probe、reopen READY
CP-REAL2-PROV-09 / CP-REAL2-PROV-10 的真实证据
```

## 4. Freeze Rule

`REAL2_B1_B5_FROZEN = YES` 表示上述 primitives、ownership、contracts 与测试证据不再在 B6 中重新设计。

B6 只能做既定 `Module.setup` 集成、恢复/重入实现所需的最小修复和真实验收；发现问题必须落到具体可复现 blocker。禁止：

- 推翻 B1～B5 的 Provisioning/Runtime 隔离；
- 把 Role credential ownership 移给 Extension/Deployment；
- 恢复人工复制 GPT URL / Schema / Bearer 的正常部署主路径；
- 用 Playwright MCP feasibility 或 mock evidence 替代真实 Extension 产品路径；
- 在 B6 重新扩成新的架构设计阶段。

在 CP-REAL2-PROV-01..11 与 RF-REAL2-PROV-01..07 全部获得要求的真实/可执行证据前，`REAL2_PROVISIONING_GO` 仍为 `NO`。
