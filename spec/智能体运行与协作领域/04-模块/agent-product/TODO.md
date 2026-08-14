---
docId: AGENT-RUNTIME-COLLABORATION-TODO-AGENT-PRODUCT
title: '`agent-product` TODO'
docType: todo
authority: operational
lifecycle: active
domain: agent-runtime-collaboration
boundedContext: agent-runtime-collaboration
moduleRef: agent-product
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- AGENT-RUNTIME-COLLABORATION-TECH-AGENT-PRODUCT
- AGENT-DOC-02-03
---

# `agent-product` TODO

> Product Role v1 只负责已存在 Task 内的需求澄清、Requirement/TaskDocument 与协作；Extension 承担 New Task/Worker teaming。Product GPT 不创建Task、不动态发现Role。

## AGT-PROD-001｜Package / Instructions / Carrier Requirements

- [ ] 固定generic Product职责，不混入Dev/Test专业Role。
- [ ] packageName作为logical Role type；roleRef/credential由Deployment/Registry配置。
- [ ] Knowledge specialization defer；不把动态Task docs写进fixed context。

## AGT-PROD-002｜Static Actions OpenAPI

- [ ] 只暴露Product实际需要：getTask、TaskDocument、askPeer/replyPeer等business-purpose Actions。
- [ ] 不暴露`createTask/listRegisteredRoles/getRegisteredRole`主链。
- [ ] no arbitrary custom headers；typed identity/idempotency/version fields。
- [ ] routine Action显式`x-openai-isConsequential:false`。

## AGT-PROD-003｜J1 Product Worker Behavior

- [ ] Extension先createTask(PENDING)并创建/绑定Product Conversation。
- [ ] Product一旦bound即可开始Requirement discussion，不等待Dev/Test全部完成。
- [ ] Requirement正式写TaskDocument；不把Conversation内容当Task truth。
- [ ] Dev/Test仍由Extension background完成bind-only teaming。

## AGT-PROD-004｜Worker Turn / Native Capabilities

- [ ] Conversation context优先；fresh Task facts按需Action读取。
- [ ] File Bridge / Code Interpreter / Web Search使用边界写入Instructions。
- [ ] one wake→0..N Actions；不依赖Browser per-action continue。

## AGT-PROD-005｜Real GPT E2E

- [ ] real GPT materialization / auth / Actions。
- [ ] Product Worker identity由Browser c-id/locator observation绑定，不猜测。
- [ ] Task terminal/reopen/history语义不被Conversation文本覆盖。

## STOP

若实现需要Product GPT自行createTask、dynamic Role discovery、Browser DOM大Context、Knowledge v1、或从GPT自然语言推进Task，停止并按架构drift处理。
