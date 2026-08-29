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

- [x] Agent Package carrier requirements 与 `chatgpt-carrier/chrome-runtime` verification 对齐 File Bridge / Code Interpreter / Web Search / Action Auth / Always Allow。
- [x] 三 Role credentialRef 独立映射；credential 不进入 Browser/Task/log plaintext。
- [x] Product static Action surface 不再包含 New Task create/discovery 主链。
- [x] Role READY 使用 behavior/capability/auth/current verification，不 pin exact model id。
- [x] Web-only GPT/workspace/auth/domain/privacy requirements 未满足时输出可恢复 `ACTION_REQUIRED`，完成后重新观察 reality。
- [x] System Observer 只消费 Deployment bounded summaries；Deployment 不保存/接受 System Assessment 作为 READY 真源。

上述为合同和实现闭环，不代表真实 Custom GPT/Browser/Provider 外部验收已经完成；外部现实仍按 `KNOWN-LIMITATIONS-AND-SPIKES.md` 与对应 blocker evidence 处理。

## 2026-08-21 Deployment CLI release freeze

- [x] `@tomflow/proflow-platform-cli@0.1.36` 与 24 个 Module 的 Registry latest 回读一致。
- [x] 523 个 executable tests、架构、类型、Biome、Conformance 与 tarball publishability 全部通过。
- [x] Fresh Workspace 验收覆盖七命令，Status 为 `14 READY / 7 ACTION_REQUIRED / 3 BLOCKED / 0 FAILED`。
- [x] 冻结证据已写入 `../08-测试用例与验证/DEPLOYMENT-CLI-0.1.36-FREEZE-EVIDENCE.json`。
- [ ] Git release commits 推送到 `origin/main`（未获本轮明确 Push 授权，不作为 npm 0.1.36 已发布事实的伪装条件）。

## 2026-08-26 配置自动化与产品交付审计

已确认源码完成：Chrome 自动安装、Extension 自动准备/重验证、Custom GPT owning flow、ChatGPT Web 机器观察、Dev Tunnel create/reuse/port/host/URL、Platform setup 全量聚合与依赖门、Provider probe、Model capability mapping/runtime lifecycle。

仍需闭环：

1. `ARCHITECTURE_STOP`：为机器可发现的 generic Provider endpoint 裁决 Deployment owner；Model Domain 不得接管 Bonjour/DNS-SD/设备识别。
2. `DELIVERY_REQUIRED`：main 与父工作区 installed packages 存在同版本内容漂移；必须新 patch version 正式交付并回读 bytes。
3. `REAL_E2E_REQUIRED`：交付后重跑七命令、Chrome/public HTTPS、模型能力与 provider-off recovery。
4. `HUMAN_BOUNDARY`：只保留 GitHub/ChatGPT 授权、Chrome 首次 Load unpacked、Provider 真正要求的 credential 和已验证候选歧义选择。

当前不得恢复人工填写 Tunnel ID/URL/port、Chrome path、Extension ID、Gateway URL、Provider LAN URL 或模型 ID 的旧正常流程。当前配置自动化边界、Microsoft Dev Tunnel 裁决与未解决问题统一见平台公共上下文 `09-Real3当前上下文与未解决问题-20260829.md`。
