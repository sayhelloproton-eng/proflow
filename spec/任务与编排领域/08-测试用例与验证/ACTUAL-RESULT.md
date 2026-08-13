# Task & Orchestration Wave 1 Actual Result

## Final executable result

```text
pnpm lint         PASS
pnpm typecheck    PASS
pnpm test         PASS (76 tests, 76 pass, 0 fail, 0 skipped/cancelled/todo)
pnpm architecture PASS (8 packages checked, 0 issues)
pnpm check        PASS
```

三个新 Module 的 own descriptor/package/adapter 通过独立测试确认 `C1/C2/C3 = PASS/PASS/PASS`。

## Runtime and boundary

- Public envelope：`contract=task-orchestration`，`contractVersion=1.0.0`，成功/失败均由 runtime 产生；失败包含 code/message/category/retryable/correlationId。
- Public surface：23/23，输入边界为 `unknown → Zod runtime validation → typed DTO`。
- 调度单元：只有 ordered Node；WorkItem/Claim/Lease/parallel Node 替代路径为 0。
- `any`：0；`.only`/`.skip`/todo escape：0。

## SQLite and transaction reality

Fresh DB introspection：

```text
business tables = 9
infrastructure tables = 1 (schema_migrations)
task_role_bindings FK = tasks.task_id
journal_mode = wal
busy_timeout = 2500
integrity_check = ok
```

Repository 使用 prepared statements 和 `BEGIN IMMEDIATE/COMMIT/ROLLBACK`。Task/Node/TaskGroup update 使用 `WHERE ... AND version = previousVersion`；stale update 的 affected rows 为 0 并触发整个 transaction rollback。注入失败后的 row count 保持 0，已提交版本行未被 stale 写覆盖。

Idempotency 使用数据库唯一主键、operation、canonical semantic request SHA-256 与 stored response。真实双连接 duplicate insert 只留下 1 行；same key/same request 返回原 envelope，same key/different fingerprint 返回 `IDEMPOTENCY_CONFLICT`。

## Task-owned behavior reality

真实两节点主链完成：

```text
PENDING → READY → ACTIVE
first Node READY → IN_PROGRESS → SUCCEEDED
next Node READY → IN_PROGRESS → SUCCEEDED
Task SUCCEEDED; currentNodeId = null
```

随后关闭并重新打开 SQLite Store，Task/Node/binding/history/document metadata 仍存在：2 个 SUCCEEDED Node、2 条 execution history、3 个文档索引、所有 required binding 非空。

WAITING、FAILED、PAUSED 分离验证：waitNode 创建 PendingMessage 并阻止推进；acknowledgeMessage 只审计/确认消息而不推进 Task；resume 保留当前 run；failNode 产生技术 FAILED；PAUSED 是 Task gate，没有 Node PAUSED。

reopen 验证 old history preserved、runNo 递增、workerRef 清空、后续 Node PENDING、currentNodeId 回退、binding/document/event 保留，下一次 startNode 从稳定 binding 重新解析同一 Worker。double startTask/startNode/completeNode/reopenNode 通过 stored idempotent response 验证。

## Markdown, filesystem, Git, and hash reality

- 正文只在 `.proflow/tasks/<owner-safe-task-segment>/documents/*.md`；SQLite 没有正文列。
- canonical 类型：REQUIREMENT、PRD、TECHNICAL_DESIGN、TEST_PLAN、TEST_RESULT、RELEASE_RESULT。
- 写入：same-directory temp file → file fsync → atomic rename → directory fsync。
- `contentHash`：真实文件内容 SHA-256；Git 临时 workspace 能观察到 Markdown untracked path。
- absolute target、额外 targetPath、`../` documentType 被 runtime/boundary 拒绝。
- 文件成功而注入 DB transaction failure 后，真实文件保留；`reconcileDocumentIndex` 扫描 owner-controlled canonical paths 并恢复 metadata/hash。

## Migration reality

- discovery 固定输出 version 1、2；duplicate version 拒绝。
- fresh apply 记录 2 条 `schema_migrations`；duplicate apply 的 applied 列表为空。
- malformed version 2 rollback，version 1 保留，version 3 未执行；修复后从 pending version 2 恢复并 verify PASS。
- fresh 与 sequential upgrade 的 applied versions 和实际 schema introspection 完全相同。
- Runner 只执行/报告 migration；Task DDL/SQL 位于 `task-store-sqlite`。

## Scope and deferred gates

```text
legacy access/mutation = 0
other Domain implementation files = 0
spec semantic drift = 0
P0 = 0
P1 = 0
```

`DEFERRED_TO_CROSS_DOMAIN`：真实 Agent provisioning、Execution Browser lifecycle、Task↔Agent/Execution runtime E2E、Gateway transport、platform-host composition。本轮没有把 adapter/contract harness 伪报为跨域 E2E PASS。

## Pre-Execution targeted regression

Task 主体未重写；本轮没有修改 Task implementation 或 Frozen Test Plan。整改实现提交为 `990ec3724cc09fcfef4c85c76274771449de0910`，初始 Wave implementation 为 `2f0a18204c0c94ea6717f3a130f21bf432a71dd0`。

以下真实 proof 在最新 main targeted regression 与全仓 `pnpm check` 中继续 PASS：

- abnormal child-process exit 后同一 SQLite 文件 reopen，数据与 integrity 保持；
- 两个真实并发 process/connection 对同一幂等事实只留下唯一记录；
- injected reopen transaction failure 对全部 reset 做 atomic rollback；
- actual result、executable test、Evidence refs 与 remediation commit 一致。

Task residual `TASK-P2-01` CLOSED；P0=0，P1=0。
