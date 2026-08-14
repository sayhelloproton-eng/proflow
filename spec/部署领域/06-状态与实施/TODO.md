---
docId: DEPLOYMENT-DOMAIN-TODO
title: 部署领域｜Domain TODO
docType: todo-index
authority: operational
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 部署领域｜Domain TODO

> 这里只保存跨 Module 或 Domain-level Gate。可直接编码的工作下沉到 Module TODO。

## Domain-level Gates

1. Public Contract 与 TypeScript contracts/runtime schema 一一对应。
2. Module Registry 与 package/service/process/deployment unit 实际落位一致。
3. Domain integration tests 通过。
4. 修改 ownership/state/effect/approval/recovery/public contract 时，执行受影响的 cross-domain contract/E2E。
5. `PENDING_SPIKE` 不得成为没有 fallback 的 correctness dependency。
6. 完成项必须回填 verification/evidence，不用“代码已写”代替验收。

## Module TODO

- [module-contract](../04-模块/module-contract/TODO.md)
- [module-template](../04-模块/module-template/TODO.md)
- [deployment-conformance](../04-模块/deployment-conformance/TODO.md)
- [platform-cli](../04-模块/platform-cli/TODO.md)
- [module-skill](../04-模块/module-skill/TODO.md)

## 2026-08-14 Domain-level Carrier Closure

- [ ] Agent Package carrier requirements 与 `chatgpt-carrier/chrome-runtime` verify/doctor 对齐 File Bridge / Code Interpreter / Web Search / Action Auth / Always Allow。
- [ ] 三 Role credentialRef 独立映射；credential 不进入 Browser/Task/log plaintext。
- [ ] Product static Action surface 不再包含 New Task create/discovery 主链。
- [ ] Role READY 使用 behavior/capability/auth/current verification，不 pin exact model id。
- [ ] Web-only GPT/workspace/auth/domain/privacy requirements 未满足时输出可恢复 `ACTION_REQUIRED(_WEB)`，完成后重新观察 reality。
- [ ] System Observer 只消费 Deployment bounded summaries；Deployment 不保存/接受 System Assessment 作为 READY 真源。
