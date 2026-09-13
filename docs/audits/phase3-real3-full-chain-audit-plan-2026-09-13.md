# Phase 3 / Real-3 全链路一致性审计执行大纲

日期：2026-09-13
状态：ACTIVE
性质：审计执行工作文档；不替代 `spec/` 下任何规范真源。
目标：以刚刚真实闭环的 Real-3 为主轴，反向校准 DDD → SDD → TDD → Tests → Source → Runtime → Human Acceptance；错误的修、过期的删、重复的合并、表达不清的重写，最终只保留当前有效设计与可验证实现。

## 审计原则

1. `spec/` 是当前实施规范唯一真源；`docs/audits/` 只记录审计过程、证据和整改状态。
2. 真实运行事实优先于历史聊天、旧 handoff、旧 release 说明；当前源码优先于缓存/索引。
3. 每个问题必须归类：`WRONG / STALE / DUPLICATE / AMBIGUOUS / MISSING / VALID`。
4. `WRONG / STALE / DUPLICATE` 默认直接整改，不保留“历史尸体”；需要保留历史时只进入 provenance / audit evidence，不留在规范正文。
5. 不把 source grep、mock green、transport success 当成真实行为证据；关键链必须尽量落到 owner fact、runtime log、真实 browser/human acceptance。
6. 任何规范改动都必须同步检查机器索引、测试契约和实际代码，不制造新的双真源。
7. Real-3 最终 owner 事实作为本轮主校准点：`task-real3-final-autowake-20260912 = SUCCEEDED v11`，Test `runNo=2`，原 Task-bound Test Worker 被复用。

## 最终交付定义

审计完成时必须同时满足：

- DDD、跨域架构、模块设计、测试设计、代码、运行时事实没有已知矛盾；
- 已解决的 Real-3 blocker 不再出现在 TODO / Known Limitation 中；
- 关键 invariant 都有可追踪的自动化或真实验收证据；
- 冗余文档、死代码、旧 fallback、过期 schema/config/fixture 被删除或合并；
- package/runtime/deployment/source 版本关系清晰；
- 最终形成 `DDD invariant → SDD design → TDD case → automated proof → runtime/human evidence` traceability；
- 仓库无由本轮引入的脏临时文件、失效引用和机器索引漂移。

## Wave 01｜DDD / 顶层领域模型

审计 Domain、Subdomain、Bounded Context、Ubiquitous Language、Owner / Does Not Own。
重点核对 Task / Node / Worker / Role / Observer / Execution / Gateway / Browser Extension / Model / Deployment 的真实职责。
清理重复概念、旧状态、旧 owner、已经被最终实现推翻的早期模型。

## Wave 02｜DDD → SDD 一致性

逐条检查领域不变量在跨域架构与模块设计中的落点。
检查 SDD 是否新增 DDD 未定义职责、是否继续描述 DDD 已废弃机制、模块 ownership / data flow / state flow 是否漂移。

## Wave 03｜SDD 完整性

审计 Task lifecycle、Node lifecycle、Worker binding、Wake、REOPEN、Resume、Permission、Attention、Execution、Recovery。
统一 READY / ACTIVE / WAITING / FAILED / SUCCEEDED、timeout / UNKNOWN / retry / idempotency 语义。
确认 automatic wake、durable handoff、restart/recovery 闭环。

## Wave 04｜SDD → TDD 一致性

每个关键设计 invariant 必须有测试设计。
重点纳入 Real-3 暴露并已实现的真实问题：characterData、recurring page recovery、transient permission-classification retry、slugged GPT URL、Role version drift、REOPEN wake、same Worker reuse、Permission action observability。

## Wave 05｜TDD → 自动化测试实现

检查测试名称与真实断言一致性；清理假绿色、只做字符串 grep 的伪行为测试、过期 fixture、重复测试。
明确 unit / integration / runtime / browser / human acceptance 分层；Owner fact 优先于 self-report。

## Wave 06｜Tests → 最终源码

逐条反查测试对应的生产路径。
发现“测试一套、运行另一套”、dead path、旧 adapter、旧 scheduler、旧 compatibility shim、重复实现并整改。

## Wave 07｜源码架构与模块边界

审计 package/module/service/process/deployment unit 边界。
重点确认 Task Orchestration 是 Task state owner；Observer 只投影/诊断；Browser Extension 只拥有 carrier/browser reality；Gateway 不成为第二业务 runtime；Platform Host composition 不越权；Execution Runtime 不重复拥有业务状态。

## Wave 08｜状态机与恢复语义

审计 start / complete / fail / wait / reopen / resume。
检查 runNo、Task/Node version、execution history、worker binding、occurrence identity、restart、UNKNOWN side effect 与幂等恢复。

## Wave 09｜Real-3 专项

从最初 blocker 到最终 `SUCCEEDED v11` 全量映射：binding 三态、Deny suppression、Attention 双向桥、restart/occurrence identity、Dev→Test WAKE、REOPEN→原 Test Worker、Permission AUTO_ALLOW、owner failure recovery、三工具独立 Test、最终 completeNode。
已解决问题必须从 blocker/TODO/limitation 中剔除；废弃方案从规范正文移除。

## Wave 10｜Browser / Carrier / Permission

审计 `x-openai-isConsequential=false`、GPT schema、package schema、materialization、permission parser/policy/action、MutationObserver、10 秒 watchdog、background recovery、attention dedupe/retry。
确认决策日志与实际动作日志可串联：classification → action dispatch → applied/released → page reality。

## Wave 11｜Worker / Role / Conversation Identity

统一 roleRef、workerRef、conversationLocator canonical 语义。
检查 `g-<id>-<slug>` URL、Role registration、validation file、Task binding、same-worker reopen/resume、重复/歧义 binding。

## Wave 12｜错误模型

统一 errorCode、retryable、failure class 与恢复能力。
清理 `OWNER_SERVICE_UNAVAILABLE / LOCAL_TOOL_RESULT_UNKNOWN / CONTEXT_MISMATCH` 等误用；技术故障不得错误映射业务 WAITING；避免 Gateway/Host/Agent 二次翻译造成语义失真。

## Wave 13｜日志与可观测性

审计 operationRef/correlation/task/node/worker 链路，action sideEffectState，日志 schema、sink、retention、noise。
重点去除无意义 heartbeat/`IDLE→IDLE` 噪音并补足 consequential action 的执行证据黑洞。

## Wave 14｜运行时与部署一致性

核对 source、package.json、lockfile、node_modules、materialized runtime、Chrome runtime、Role adopt、Host cache/restart。
审计 `install/setup/start/status` 边界与 Dev Tunnel / Extension / Gateway / Host / Execution 健康检查。

## Wave 15｜依赖与 Package 治理

检查 package 依赖环、重复 dependency、版本漂移、废弃 exports/API/package、无意义 compatibility shim、changeset 消费残留与 release amplification。

## Wave 16｜数据层与持久化

审计 Task SQLite schema、migration、events、execution history、role bindings、documents、idempotency、recovery journal。
确认 fail/reopen/retry 历史保留正确，避免重复 truth store 与孤儿恢复状态。

## Wave 17｜安全与授权

核对 Role capability matrix、Gateway/Host admission、Browser Effect Gate、Product/Dev/Test 权限、secret/token 路径、日志脱敏、fail-closed 行为。

## Wave 18｜配置与 Schema

对齐 OpenAPI、Zod/schema、TypeScript types、runtime parser、Custom GPT Action schema。
清理旧字段、旧 operationId、旧 config key、nullability/required/enum 漂移。

## Wave 19｜文档治理

明确规范真源、过程记录、状态/TODO/provenance 的边界。
合并重复章节，删除过期 blocker / 过时方案 / 失效交接内容，修正机器索引与 Markdown 正文漂移。

## Wave 20｜仓库卫生

清理一次性 debug/临时脚本、失效 fixtures、旧 artifact/bundle、误 tracked runtime/generated files、无效 TODO/FIXME、死文件、空目录、重复 README/config。

## Wave 21｜最终 Acceptance / Gate

重建正式 traceability：DDD invariant → SDD → TDD → automated proof → runtime evidence → human acceptance。
关键链不得以“源码存在”或“测试绿色”代替真实 Runtime/Browser owner 证据。

## Wave 22｜性能与工程吞吐

审计 Real-3 长期阻塞的结构性原因：loopback、重复扫描/decision、observer 高频噪音、timeout、release amplification、模块耦合与多余 round trip。
只保留可证明有收益且不破坏 ownership 的优化。

## 执行顺序与整改规则

按 Wave 01 → 22 顺序推进；允许在发现跨层矛盾时记录依赖，但不跳过上游真源直接修改下游表象。
每个 Wave 输出：`Scope / Evidence / Findings / Changes Applied / Verification / Residual`。
整改优先级：`错误 → 过期 → 重复 → 缺失 → 表达不清 → 优化`。
规范冲突优先修上游 canonical owner，再同步下游引用与机器索引。
代码冲突优先修真实运行 owner，再同步测试与设计；不得为保住旧测试而保留错误实现。

## 当前已知 Real-3 终态校准事实

- Task：`task-real3-final-autowake-20260912`，Owner 持久化状态 `SUCCEEDED v11`，`current_node_id=null`。
- Dev：`real3-dev-20260912 = SUCCEEDED run 1`。
- Test：`real3-test-20260912 = SUCCEEDED run 2`；经历 `FAILED v8 → REOPENED v9 → STARTED v10 → COMPLETED v11`。
- REOPEN 复用原 Test Worker：`6aa2b749-87f4-83e8-bc7f-929161400e39`，未创建新 Worker。
- Test run 2 独立拿到 Repomix / CodeGraph / Local Dev 成功证据，并正式 `completeNode`。
- Permission 链已真实出现 `ACTION_PERMISSION → browser.permission.classify SUCCEEDED → BUSY:GENERATING`；本地源码另已补 `PERMISSION_ACTION` dispatch 可观测性，但该补丁尚未单独发布。

## 收口产物

1. 本执行大纲。
2. 每 Wave 的 findings / remediation 可追踪记录；只有需要长期保留的审计证据才落 `docs/audits/`。
3. 被整改后的 canonical `spec/`、测试与源码。
4. 最终 Phase 3 / Real-3 traceability 与 closure 结论。
5. 最终仓库 hygiene / conformance / targeted gate 证据。
