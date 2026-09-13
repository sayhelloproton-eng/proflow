# Phase 3 / Real-3 Audit Wave 11｜Worker / Role / Conversation Identity

日期：2026-09-13

## Scope

审计 `agentPackageRef → roleRef/g-id → workerRef/c-id → conversationLocator` 的 canonical ownership、Task binding、slugged GPT URL、same-worker reopen/resume、重复/歧义 binding 与 Carrier restore/permission identity。

## Evidence

- `AGENT-DOC-03-06` 冻结“一个 Task 一个三人组；不同 Task 不复用 Conversation；同一 Task reopen 复用原 Worker/Conversation”。
- Real-3 Flow 明确 Role 可服务多个 Task，但每个 Task 拥有独立 Worker identity。
- `worker-carrier-target.ts` 从 Task Owner 读取 durable `conversationLocator` 后 restore，不用 `roleRef + workerRef` 重构 URL。
- `bindTaskWorker` 原实现只防同一 Task 内覆盖冲突；没有阻止跨 Task 复用相同 workerRef/conversationLocator。
- `browser-permission-context.ts` 原测试还显式允许同一 Worker/Conversation exact duplicate 出现在多个 Task，并在无 taskId Permission classification 中视为可授权。
- `createTask` schema 原先允许调用者直接传非空 workerRef/conversationLocator，绕过 J1 的 create-new-Conversation → observe → bind owner path。

## Findings

### W11-F01｜VALID｜Task-scoped Worker identity 未在 Owner 边界强制

规范要求不同 Task 独立 Worker/Conversation，但 Task public command 与 Permission defensive resolver 都允许跨 Task exact reuse。这会让 task-agnostic Permission 在无法确定具体 Task occurrence 时仍可能被错误 AUTO_ALLOW。

### W11-F02｜VALID｜createTask 可预绑定 Worker

J1 冻结为先创建 PENDING Task，再创建新的真实 Conversation 并观察 c-id，最后通过 `bindTaskWorker` 写入。原 schema 允许 createTask 直接携带非空 binding，绕过了该 identity establishment boundary。

### W11-R01｜DEFER_TO_WAVE18｜slug normalization 的 32-character provider assumption

`carrier-identity.ts` 对真实 slugged GPT URL 使用 32-character g-id 归一化；当前真实 Real-3 资源与 regression fixture 都符合该格式，但 Task/Agent Contract 把 roleRef 定义为 opaque，Role runtime schema 本身未冻结 32-character 长度。当前没有真实 provider 反例，不能在 Identity Wave 猜测新的外部格式；Wave 18 Schema/Config 必须决定是冻结 provider grammar 还是改为基于 authoritative expected roleRef 的解析。

## Changes Applied

- `createTask` runtime schema 要求三个 role binding 的 workerRef/conversationLocator 初始都为 null。
- `bindTaskWorker` 在 Owner transaction 内扫描现有 TaskRoleBinding；任一其他 Task 已使用同 workerRef 或 conversationLocator 即返回 `TASK_ROLE_BINDING_CONFLICT`，零写入。
- task-agnostic Browser Permission resolver 对第二个 Task identity match 直接 fail-closed，即使字段完全相同。
- Public API contract 明确不同 Task 不复用 Worker/Conversation；同一 Task reopen/resume 继续复用原 binding。

## Verification Gate

- Task owner real SQLite integration：pre-bound create 被拒绝；cross-Task worker/locator reuse 被拒绝且第二 Task 零 mutation；既有 same-Task idempotency/reopen 继续 PASS。
- Platform Host permission context targeted tests：duplicate Task identity fail-closed；conflict/unreadable/task-scoped cases继续 PASS。
- Browser identity/slugged URL regression继续 PASS。
- Task Orchestration 与 Platform Host typecheck PASS。

## Residual

- 本 Wave 不改变 same-Task REOPEN/RESUME 复用语义。
- 不发布/部署。
- 32-character slug normalization assumption 进入 Wave 18，不冒充已解决。
