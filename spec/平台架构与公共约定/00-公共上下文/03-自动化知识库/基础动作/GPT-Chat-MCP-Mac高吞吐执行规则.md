# GPT Chat × Custom MCP × Mac 本地工程高吞吐执行规则

> 性质：GPT Chat 调度自定义 MCP 与 Mac 本机工程资源时的**唯一高吞吐执行 owner**。
> 适用链路：`GPT Chat Model → Custom MCP → Mac Local Runtime → Repo / Git / Shell / Test / Build / Runtime / Browser / Process / Log`。
> 当前状态：`CORE THEORY=VERIFIED / EXECUTION MODEL=VERIFIED / OPTIMIZATION=IN_VALIDATION / QUANTIFIED BASELINE=PENDING`。
> 证据来源：ProFlow RAG P5/P6、跨仓 P7；后续继续用 ProFlow Real-3 与其它项目做反例驱动验证。

## 0. 这份规则解决什么

本规则不讨论“模型怎样更快写代码”，也不优化几毫秒的本地文件 I/O。它只优化一条现实中昂贵的调度链：

```text
GPT Chat
  ↓ decision / tool call
Custom MCP connector
  ↓
Mac local runtime
  ↓
files / git / shell / tests / build / DB / browser / processes / logs
  ↓ evidence
Custom MCP connector
  ↓
GPT Chat 再次建立状态并决策
```

在当前环境，单次本地文件处理可能只有毫秒级，而一次完整 `GPT → MCP → Local → MCP → GPT` 往返常为数十秒。因此高吞吐优化的首要对象是**协调成本**，不是本机计算成本。

本文件替代旧的“按文件/命令批量化”执行理论。旧规则中仍有效的四 Plane、Batch、Reality-first、FIRST_DIVERGENCE、fail-closed、UNKNOWN recovery 等能力已被重新归入本协议；不得再维护第二套并列高吞吐 SOP。

## 1. 成本模型｜Round-trip Dominance

总 wall-clock 近似：

```text
T_total
= T_engineering_critical_path
+ T_necessary_coordination
+ T_avoidable_coordination_waste
```

其中 GPT Chat 最能优化的是：

```text
T_avoidable_coordination_waste
= repeated reads
+ repeated replanning
+ unnecessary tool round-trips
+ repeated verification
+ low-value polling
+ context rehydration
+ wrong-owner debugging
+ avoidable recovery
```

当单次 MCP 往返成本 `R` 远大于单个局部本地计算 `C_local` 时：

```text
T ≈ N_roundtrip × R + C
```

因此第一优化律固定为：

> **Reduce Calls Before Reducing Compute.**

但“少调用”不是目的。真正目标是：**每次调用承载更大的有效工程决策信息，同时保持 fail-closed 与真实证据强度。**

## 2. 执行粒度｜Stage 编排，Decision 落地

必须区分两层：

```text
Stage = orchestration unit
Engineering Decision = mutation unit
File = decision projection
Command = execution primitive
Test = evidence primitive
```

一个 Stage 可以包含 1..N 个独立 Engineering Decisions；禁止为了提高 Mutation Density 把整个 Stage 强行合成一个超大 Batch。

一个 Engineering Decision 应按下面链路执行：

```text
Engineering Decision
  ↓
Blast Radius
  ↓
Minimum-Sufficient Context
  ↓
Decision / Patch Plan
  ↓
Fail-closed Atomic Decision Batch
  ↓
Blast-Radius Verification
  ↓
Decision Closed
```

多个 Decision 完成后，Stage 才进入统一 Formal Gate。

### 核心定律

> **AI 工程执行的最小有效 mutation 单位不是 File，而是 Engineering Decision。**

同一个决策影响 Domain / Application / Contract / Adapter / Public API / Test / Spec / README 时，这些不是八件工作，而是一个 Decision 的多个 projection。

## 3. Minimum-Sufficient Context｜先建立局部完整世界模型

修改前必须一次性获取完成当前 Decision 所需的**最小充分上下文**。不是越多越好，也不是“只读眼前文件”。

典型覆盖：

```text
CURRENT / current authority
Owning Spec / Contract
Domain / Application
Adapters / Public API
Tests / Eval
README / ADR（仅当决策会改变其语义）
相关 runtime / DB / browser evidence（仅当当前决策依赖真实现场）
```

固定原则：

```text
Context Completeness Before Mutation
Context Precision Before Context Volume
```

禁止两种反模式：

1. **过窄**：读一个文件就先 commit 设计判断，后续不断补读、重规划、补改。
2. **过宽**：为了“一次读完”把 build output、generated bundle、无关 package、历史记录全部灌入模型。

Context scope 必须由当前 Decision 的 blast radius 决定；每次扩大范围都要有明确的新不确定性理由。

## 4. MCP Authority Routing｜每个 MCP 只拿不可替代证据

四类能力仍保留，但不再是固定“四连调用”：

```text
Context Plane
  Repomix
  → 最小充分仓库上下文、稳定 outputId、grep/read

Structure Plane
  CodeGraph
  → caller/callee、ownership、composition、blast radius

Execution Plane
  Local Dev
  → 当前磁盘、批量读写、Git、shell、test/build、PID/log、真实命令

Reality Plane
  Playwright Chrome / AX + screenshot
  → 当前 Browser/UI 用户现实
```

第一刀由**当前最大不确定性**决定：

- Browser/UI symptom → Reality first。
- 跨文件仓库理解/修改 → Context first。
- 已知 symbol，只问结构/ownership → CodeGraph first。
- 纯 Git/test/build/PID/Registry/Workspace readback → Local Dev directly。
- MCP runtime 自身异常 → 先恢复 Tool Runtime，再返回原业务 checkpoint。

禁止：

```text
Repomix 全仓
→ CodeGraph 再全仓
→ Local Dev 再逐文件重读
```

一个工具已经消除的不确定性，不得由下一个工具为“确认一下”整域重复获取。

## 5. Decision Contract｜写之前一次想清楚

Context 完成后先冻结 Decision Contract；Patch Plan 可以在模型内部完成，不要求额外 Tool Call。

至少明确：

```text
DECISION
目标行为 / 不变量

BLAST_RADIUS
new files
modified files
deleted files
ownership changes
contract changes
error semantics
runtime/db/browser impact

TRANSFORM
anchors
expected match count
new public/private symbols
migration / compatibility handling

VERIFY
L1 assertions
L2 affected verification
Stage Gate 是否需要变化

DOCS
哪些 owner 文档必须同步
哪些历史/README 不应触碰

STOP
任何 preflight mismatch / new authority / unexpected scope expansion 的停止条件
```

这是一次内部 engineering dry-run：

> **Think in Batch Before Mutating in Batch.**

## 6. Fail-closed Atomic Decision Batch

Batch-first 必须和 fail-closed 绑定。目标不是“一次改很多”，而是“一次 Engineering Decision 完整落地”。

固定事务模型：

```text
A. PRELOAD ALL
B. PREFLIGHT ALL
C. TRANSFORM ALL
D. COMMIT BATCH
E. ONE DIFF AUDIT
```

### Formatter 属于 Batch Mutation，不属于返工

如果仓库存在 canonical formatter，格式化必须在 `COMMIT BATCH` 内完成，再进入 L1/L2；不得先以未格式化源码进入 targeted verification，随后因为 formatter 单独制造一次 repair round。格式化不改变 Engineering Decision，但它属于可读性与机械完整性的 commit step。

### Preflight Atomicity

任何 anchor / expected count / authority 不匹配：

```text
STOP
0 mutation
```

必须先重新获取唯一漂移证据，再决定是否重新冻结整个 Decision Batch。

### Commit Atomicity

“Preflight fail → 0 mutation”不等于文件系统天然事务化。Commit 阶段必须优先使用可一次 check/apply 的 patch 或等价可恢复机制；若只能多文件写入，则必须有明确的 partial-write 检测与 Git/diff recovery，不得把逻辑 Batch 宣称为真正 filesystem transaction。

当前理论状态：

```text
FAIL_CLOSED_PREFLIGHT_ATOMICITY = VERIFIED
LOGICAL_DECISION_BATCH = VERIFIED
FILESYSTEM_TRANSACTION_ATOMICITY = PARTIAL / CONTINUE_VALIDATION
```

### 可读性约束

Mutation Density 不得通过压缩源码换取：

- 正常格式化；
- 清晰责任边界；
- 有意义命名；
- 必要 why-comment；
- 人类可 review；
- 后续 AI 可继续低成本读取。

## 7. Verification Pyramid｜不降低验证，只消除重复验证

### L1｜Preflight / Static

最低成本证明机械完整性：

```text
anchor / expected count
syntax / parse
node --check（适用时）
git diff --check
schema/json validation（适用时）
```

### L2｜Blast-Radius Targeted Verification

只验证当前 Decision 的 changed + dependency-reachable affected surface：

```text
targeted regression
affected package typecheck
affected smoke/eval/benchmark
必要 runtime/db/http probe
```

### L3｜Formal Stage Gate

Stage 中所有 Decisions 稳定后只执行一次系统级 Gate：

```text
architecture
contract/typecheck/build
DB/runtime/integration
eval/degradation
真实外部 evidence
```

原则：

> **Reverify the Blast Radius, Not the Universe.**

如果 L2 某项失败后只修改 Eval Adapter SQL，就只重复该修改可达的验证层；已经 PASS 且不可达的 Domain/Application/Contract 不重复证明。最后由 L3 Formal Gate 统一兜底。

## 8. Failure Classification｜先压缩 Debug Search Space

任何 FAIL 先分类，再搜索：

```text
CODE
DATA
CONTRACT
RUNTIME
INFRASTRUCTURE
TOOL_CONNECTOR
VERIFICATION_HARNESS
EXTERNAL_AUTH_RESOURCE
```

固定链：

```text
failed stage
→ failure category
→ owner
→ blast radius
→ targeted evidence
→ repair decision
```

`Test FAIL != Product FAIL`。Harness 本身是软件系统，也必须被审计；timeout、fixture、process lifecycle、measurement、stale process 等不得自动升级成产品 regression。

> **Failure classification 是压缩无效 Debug Search Space 的第一步。**

## 9. Long Task｜从 Time-based Polling 升级为 Decision-value Observation

长任务默认模型：

```text
START ONCE
→ persist PID/session + log + exit authority
→ allow runtime to work
→ recover once near expected completion or on event
→ inspect terminal authority
```

不是：

```text
start
→ poll
→ poll
→ read log
→ poll
→ read process
→ poll
```

定义：

```text
Polling Tax = N_poll × RoundTripCost
```

一次 observation 只有可能产生以下至少一种 Decision Delta 才值得调用：

```text
CONTINUE
STOP
RECOVER
REPAIR
PROVE
```

如果唯一结果是 `still running / same state / no new evidence`，它是 visibility，不是 progress。

允许中途观察的典型事件：

- early crash；
- UNKNOWN / non-idempotent mutation；
- interactive prompt / blocked input；
- resource runaway；
- 已接近合理完成窗口且需要回收 final authority。

MCP session 丢失不等于真实本地 process 丢失；先通过 persisted PID/log/exit 恢复 authority，禁止盲 rerun Formal Gate。

对预计几十秒以上、且运行期间无需交互的 Formal Gate，优先使用：

```text
command output → persisted log
terminal exit/result → stdout once
GPT 在预计完成窗口回收 terminal authority
需要细节时再按 persisted log 一次读取
```

这样让中间 `still running` 状态不穿过 MCP 往返链。

## 10. 横向吞吐与纵向编排必须分开

这是本协议的核心结构：

```text
横向：Decision-level Batch
纵向：Authority State Trigger
```

横向不要逐文件；纵向不要把最终目标写成无条件步骤清单。

例如：

```text
只有 REGISTRY_EXACT=PRESENT
→ 才允许 Workspace update

只有 SETUP_WAITING_FOR_EXTENSION
→ 才允许 Reload

只有 LOGIN + TUNNEL + PORT remote reality 明确
→ 才允许消费高成本 production start
```

后续 mutation 必须由前序 authority state 触发，而不是因为“计划里的下一步就是它”。

## 11. Stage-level Execution｜理想高价值调用预算

一个典型 Stage：

```text
1. Minimum-Sufficient Context Acquisition
2. Decision / Patch Plan
3. Atomic Decision Batch
4. Targeted Verification
5. Optional Single Blast-Radius Repair
6. Formal Stage Gate
7. Closeout + Final Review + Metrics
```

Patch Plan 通常不需要工具调用。目标不是机械追求固定次数，而是把调用压缩到高信息密度区间：

```text
Context              1~2
Mutation             1 / decision
Targeted Verify      1
Optional Repair      0~1
Formal Gate          1 / stage
Gate Recovery        0~1
Closeout / Final     1
```

当 Tool Call 数持续增加时，第一反应不是“工具太慢”，而是检查：

- Decision 是否还没冻结；
- Context 是否过窄导致补读；
- Context 是否过宽导致注意力污染；
- Failure 是否未分类；
- owner 是否不清；
- verification 是否重复；
- polling 是否没有 Decision Value。

## 12. Throughput Metrics｜从经验进入可测方法

后续真实 Stage 建议自动记录：

```text
stage_wall_ms
necessary_critical_path_ms

tool_round_trips
context_calls
mutation_calls
poll_count

targeted_runs
formal_gate_runs
rework_rounds
preflight_abort_count
post_mutation_repair_count

planned_files
final_changed_files
scope_expansion_reason
context_relevant_units
context_total_units
```

### EER｜Execution Efficiency Ratio

避免把并发 build/typecheck/runtime 简单相加。定义为：

```text
EER
= Necessary Engineering Critical-path Wall Time
/ Total Stage Wall Time
```

理想 `EER → 1`，表示大部分 wall-clock 花在真实工程关键路径，而不是 AI 协调浪费。

### Decision-value Call Rate

TCID 的 `Useful Information` 难完全客观量化，因此优先记录机械代理：

```text
DVCR
= calls that cause CONTINUE/STOP/RECOVER/REPAIR/PROVE decision delta
/ total tool calls
```

### Context Precision

```text
Context Precision
= Relevant Decision Context
/ Total Acquired Context
```

低 Call 数但吞入大量 build output/generated bundle 仍然是低效。

### Decision Completeness

不要惩罚新 evidence 合法触发的 scope expansion：

```text
MISSED_CONTEXT_EXPANSION
EVIDENCE_TRIGGERED_SCOPE_EXPANSION
```

只把第一种计入 First-pass Completeness 缺陷。

### Batch Failure

拆分：

```text
Preflight Abort Rate
Post-Mutation Repair Rate
```

前者代表 context/anchor drift，通常状态安全但影响吞吐；后者更能反映 Decision/Patch Plan 完整性。

### Mutation Density

```text
Mutation Density = Correctly Changed Files / Mutation Calls
```

只有同时满足以下条件才有意义：

```text
Atomicity PASS
Readability PASS
Verification PASS
Rework controlled
```

禁止为追求指标制造超大 Batch。

## 13. 反模式

以下行为默认视为吞吐异常：

1. `read → edit → read → edit` 的 per-file loop。
2. 同一仓库事实被 Repomix、CodeGraph、Local Dev 整域重复读取。
3. 为“确认一下”重复读取没有 authority 变化的状态。
4. 一次失败后重新怀疑整个系统，而不是先分类 owner。
5. 修 Eval SQL 后重跑所有已 PASS 的 Domain/Contract tests。
6. Formal Gate 运行中高频 process/log polling。
7. MCP session 断开后不恢复本地 authority，直接重跑长 Gate。
8. 为减少 Tool Call 把无关 build output / generated bundle 一次吞入 Context。
9. 为提高 Mutation Density 把多个独立 Engineering Decisions 合并成一个超大 Batch。
10. 批量生成不可读的一行 function，再另开格式化返工轮次。
11. 用“Batch”掩盖没有 fail-closed preflight 或 partial-write recovery。
12. 把 Harness FAIL 直接标成 Product FAIL。

## 14. 当前理论验证状态

截至 ProFlow RAG P5/P6 与跨仓 P7：

```text
ROUND_TRIP_DOMINANCE             = VERIFIED
DECISION_LEVEL_EXECUTION         = VERIFIED
MINIMUM_SUFFICIENT_BATCH_CONTEXT = VERIFIED
FAIL_CLOSED_BATCH_PREFLIGHT      = VERIFIED
SELECTIVE_REVERIFICATION         = VERIFIED
FAILURE_CLASSIFICATION           = VERIFIED
VERIFICATION_PYRAMID             = VERIFIED
HUMAN_READABLE_BATCH             = VERIFIED
SINGLE_FORMAL_STAGE_GATE         = VERIFIED
CROSS_REPO_EXECUTION             = VERIFIED / P7

EVENT_ORIENTED_OBSERVATION       = PARTIAL
FILESYSTEM_COMMIT_ATOMICITY      = PARTIAL
FIRST_PASS_COMPLETENESS          = IN_VALIDATION
THROUGHPUT_METRICS               = IN_VALIDATION
QUANTIFIED_SPEEDUP               = NOT_FROZEN
CROSS_DOMAIN_GENERALIZATION      = PENDING
```

已有证据只证明协调效率显著改善；不能把未统一测量的 `2×/3×` 经验体感写成正式整体 wall-clock 倍率。

## 15. 继续验证协议

本规则不是写完冻结，而是以真实项目持续验证：

```text
Rule
→ real Engineering Stage
→ collect metrics + first divergence
→ classify counterexample
→ amend single owner
→ replay in later Stage/project
```

每次验证至少记录：

```text
VALIDATION_ID
PROJECT / STAGE
ENGINEERING_DECISIONS
TOOL_ROUND_TRIPS
CONTEXT_CALLS
MUTATION_CALLS
POLL_COUNT
TARGETED_RUNS
FORMAL_GATE_RUNS
PREFLIGHT_ABORTS
POST_MUTATION_REPAIRS
SCOPE_EXPANSIONS
WALL_CLOCK
NECESSARY_CRITICAL_PATH（可测则记录）
QUALITY_GATE
THROUGHPUT_FINDING
RULE_CHANGE
```

### 接下来两批真实验证

```text
VALIDATION_BATCH_1
= ProFlow Dev Tunnel 诊断语义缺陷
目标：验证 Decision-level context、failure classification、最小 blast radius、selective reverify、低 polling。

VALIDATION_BATCH_2
= ProFlow Real-3 真实环境验证
目标：验证 Reality-first + State Trigger + event-oriented long-task recovery，在 Browser / Tunnel / Runtime / Owner durable state 混合现场下是否仍能保持高吞吐与 fail-closed。
```

Batch 1/2 的真实结果必须回写本文件；若发现反例，优先修改本规则，不再衍生第二套吞吐理论。

### Validation Batch 1｜ProFlow Dev Tunnel 诊断语义缺陷

```text
VALIDATION_ID = PROFLOW-THROUGHPUT-V1-B1
PROJECT / STAGE = ProFlow / Dev Tunnel diagnostic hardening
ENGINEERING_DECISIONS = 1
CONTEXT_CALLS = 4 / 3 Structure+Contract + 1 minimum-sufficient source/test batch
MUTATION_CALLS = 2 / initial decision batch + one bounded repair
TARGETED_RUNS = 2
FORMAL_GATE_RUNS = 1
PREFLIGHT_ABORTS = 0
POST_MUTATION_REPAIRS = 1
SCOPE_EXPANSIONS = 0
POLL_COUNT = 4 / early validation path; exposed residual waste
FORMAL_GATE_LOW_VALUE_POLL = 0 / persisted-log + terminal-marker harness
QUALITY_GATE = PASS / 42_OF_42 + typecheck + Biome + git diff --check
```

结果：Decision-level blast radius 一次锁定在 `dev-tunnel` 本包，没有扩散到 Platform/Task/Execution；第一次产品行为 tests 已 42/42 PASS，失败仅为一个 `exactOptionalPropertyTypes` 构造问题与 formatter，按 `CODE_TYPING + FORMAT` 分类后只修可达范围，没有重做 Context 或 Debug。修复后只跑新增行为 tests + typecheck/Biome/diff，再执行唯一 package Formal Gate。

反例与规则修正：

1. canonical formatter 应进入第一次 Batch Commit，而不是 targeted verify 后再产生 repair；本文件已新增 Formatter 规则。
2. 长任务普通 stdout 会诱发 Chat 提前 read；Formal Gate 改为“输出落持久日志 + terminal marker 一次回收”，本轮正式 Gate 中间低价值 poll 从早期路径的 4 次降为 0。
3. `EVENT_ORIENTED_OBSERVATION` 仍保持 `PARTIAL`，需在 Real-3 混合 Runtime/Browser/Owner 现场继续验证。


## 15.1 Mainline-first Validation｜先完成主线，再评估吞吐策略

吞吐规则是运行时自优化机制，但不能成为新的主线。真实 Stage 执行期间：

```text
自动采集 tool_round_trips / poll / repair / harness defect / authority recovery
→ 发现会阻塞当前主线的执行缺陷：最小修复
→ 发现只是“还能更快”的优化点：记录，不中断主线
→ 当前 Mainline Gate 完成
→ 再统一做 before/after、反例、规则修订
```

模型应主动完成这套感知和沉淀，不等待用户要求“总结吞吐效果”。只有真实 Stage 结束后的证据才能把候选优化升级为本文件正式规则。上下文自动写回的 owner 在 `01-长期规则/02-公共上下文治理规则.md`。

## 16. 新任务执行口令

GPT Chat 接到本机工程任务后，默认自检：

```text
1. 当前 Stage 是什么？当前 Engineering Decision 是什么？
2. 哪个 authority 能最快消除最大不确定性？
3. 完成该 Decision 的 Minimum-Sufficient Context 是什么？
4. Blast Radius 是否已经足够完整？
5. 写前 Patch Plan / anchors / STOP 是否冻结？
6. 能否一次 fail-closed Decision Batch 落地？
7. L1 / L2 分别证明什么？哪些已 PASS 层不应重测？
8. 长任务下一次 observation 是否真的会改变决策？
9. Stage 最终 Formal Gate 是否只需要一次？
10. 本轮是否产生可用于继续验证该规则的吞吐指标/反例？
```

最终目标不是“最少操作”，而是：

> **最高有效工程决策密度 + 最低可避免协调浪费 + 完整 Fail-closed + 真实 Engineering Evidence。**
