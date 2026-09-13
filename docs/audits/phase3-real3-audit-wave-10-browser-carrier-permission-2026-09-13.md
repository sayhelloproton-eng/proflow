# Phase 3 / Real-3 Audit Wave 10｜Browser / Carrier / Permission

日期：2026-09-13

## Scope

审计 shipped Action consequential metadata、Permission detector/policy/actuator、DEFER/HUMAN_REQUIRED、Deny suppression、Attention occurrence identity、restart/recovery、semantic action dispatch、release/page reality 与 structured observability 的同链一致性。

## Evidence

- 三 Role shipped Action schema 的现有 executable proof要求所有 operation 显式 `x-openai-isConsequential:false`。
- Permission lifecycle 已区分 `AUTO_ALLOW / DEFER / HUMAN_REQUIRED`，AUTO_ALLOW 只选择 `allowAlways` 或 `allow`，`allowOnce` 仅人工。
- recurring page watchdog/recovery、transient classification retry、Deny suppression、occurrence identity、uncertain-attempt no-blind-replay 已有当前源码与 targeted executable proof。
- 当前 `operation-observer.ts` 的 release 后 `PAGE_REALITY_TRANSITION` 只从新 observation 取 blocker axes；`BLOCKED:ACTION_PERMISSION → IDLE/BUSY` 时新 observation 不再含 blocker，最终 reality 与 classify/action fingerprint 失去机械关联。

## Findings

### W10-F01｜VALID｜Permission release final-reality correlation gap

classification、semantic action dispatch 与 Permission outcome 都以 permission fingerprint 关联，但最终页面解除 blocker 后丢失该 fingerprint。结果是“决定/点击/结果”有证据，“同一 occurrence 的最终 page reality”却不能机械串联。

### W10-F02｜VALID｜现役 Always Allow wording drift

部分 active operational/normative 文档仍把 `Always Allow` 写成 ordinary happy-path setup。当前冻结语义应为：ordinary shipped Actions 显式 nonconsequential；Permission 只作为 unexpected Carrier fallback；可信 AUTO_ALLOW 优先页面真实 `allowAlways`，否则 `allow`；`allowOnce` 仅人工；Execution Approval 始终独立。

## Changes Applied

- 新增 production helper `page-reality-correlation.ts`，只在同 `tabId + contentInstanceId + URL` 上让 release/continuation reality 继承上一 Permission occurrence 的 fingerprint/operation correlation；navigation/content replacement 不继承。
- `operation-observer.ts` 的 `PAGE_REALITY_TRANSITION` 使用该 production helper。
- 新增行为测试覆盖 current Permission、自 Permission 到 IDLE 的继承、content replacement/navigation 切断、非 Permission 不制造 correlation。
- 对齐 Agent limitation、Execution domain gate、implementation roadmap 与 Real Browser E3 wording；不改变 Permission policy、Task/Execution ownership 或真实点击策略。

## Verification Gate

Wave 10 只有在以下 current-tree gate 全部通过后才可标 DONE：page-reality correlation + operation observability + permission action/parser/watchdog/recovery targeted tests、全部 shipped Action consequential=false contract test、execution-browser-extension typecheck、runner authority/diff check。

## Residual

- 本 Wave 不发布/部署 Extension，不以自动测试替代真实 Chrome gate。
- `CP-EXE-BR-49` SAME_SCENE 仍只接受真实 Chrome evidence。
- 深层历史/说明性文档中的旧 `Always Allow` 字样留给 Wave 19 文档治理统一清理；不得反向改变本 Wave 已冻结的 current normative semantics。
