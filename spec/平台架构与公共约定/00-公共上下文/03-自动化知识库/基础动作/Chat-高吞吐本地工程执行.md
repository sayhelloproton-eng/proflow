# Chat 高吞吐本地工程执行

> 建立时间：2026-09-03
> 性质：跨包、跨仓库可复用的本地工程执行 Harness。
> 目标：在普通 Chat 中组合 Repomix + CodeGraph + Local Dev（需要真实 Browser 时再加 Playwright），用大粒度上下文、结构导航、批量执行和现实验证减少 Agent ↔ Tool 往返、重复读取和 per-file loop，尽量接近 Work 的仓库执行吞吐。

## 1. 问题定义

“拥有本地读写工具”不等于“拥有高吞吐工程 Harness”。最常见的慢路径是：

```text
CodeGraph
→ 模型
→ read_file A
→ 模型
→ read_file B
→ 模型
→ edit_block A
→ 模型
→ edit_block B
→ 模型
→ test
→ 模型
→ reread / repoll ...
```

真正的优化对象是 **Agent ↔ Tool round trip 数量**，不是单纯减少命令字符数。

## 2. 四 Plane 心智模型与任务路由

```text
Context Plane   Repomix
  解决“Chat 怎样用更少往返快速获得仓库级上下文”

Structure Plane CodeGraph
  解决“谁调用谁、从入口到实现经过哪些层、改动影响哪里”

Execution Plane Local Dev
  解决“当前磁盘到底是什么、如何批量修改、如何运行 Git/测试/命令”

Reality Plane   Playwright Chrome + AX / Swift
  Playwright 解决普通 Web/ChatGPT/Tasks 的 DOM、URL、Console/Network、page screenshot
  AX / Swift + screenshot 解决 `chrome://`、Extension privileged UI、系统 picker 等 Chrome 安全边界

Tool Runtime     gptweb-mcp
  不是第五个业务 Plane；只负责 Repomix/CodeGraph/Local Dev/Playwright 的 runtime、relay、token、manager 恢复
```

先分类任务，不机械串四层：

| 任务类型 | 默认第一入口 | 典型链路 |
|---|---|---|
| 仓库理解或准备修改 | Repomix | 先确定最小充分 scope → 一次批量上下文 → 必要时 CodeGraph → 进入统一 Batch 修改协议 |
| 只问 caller/callee、ownership、composition、blast radius，且不立即改码 | CodeGraph | 一次 explore → 必要时 Local Dev current-disk 交叉确认 |
| 纯 Git/测试/命令、无需代码理解的已知机械动作 | Local Dev | Local Dev |
| 普通 Web UI、登录、授权、真实 ChatGPT/Tasks 页面 | Playwright | screenshot/snapshot 观察 → 必要时 Repomix/CodeGraph/Local Dev 归因 → 原页面复验 |
| `chrome://`、Extension errors/toolbar、系统 picker 等 privileged UI | AX / Swift + screenshot | AX tree + screenshot → one privileged mutation → screenshot → 回 Playwright/Owner authority |
| MCP runtime / connect / token / manager 异常 | Tool-Runtime | 恢复工具 runtime → 回原业务 checkpoint；不要进入产品源码猜测 |

**判断标准不是“哪个工具更强”，而是谁能以最少往返消除当前最大的不确定性。**

### 2.1 Reality-first override 与 Context-first 的边界

`Repomix first` 只约束**仓库理解/修改任务**。如果当前问题首先是“页面为什么是这样”“Chrome 为什么显示 Error/Permission/Unexpected Page”，最大不确定性在 Reality Plane，先看现实：

```text
Browser/UI symptom
→ current screenshot / snapshot / AX tree
→ 判断 fresh reality
→ Owner/runtime readback
→ 只有证据指向代码时，才切成 repository task
→ Repomix / CodeGraph / Local Dev
→ 回 SAME SCENE 复验
```

因此：`Browser error → 先 pack/read source` 是反模式；`已经证明是 package bug → 还只在 Browser 猜` 同样是反模式。工具切换由证据边界触发。

### 2.2 信息增益优先，而不是“工具齐全”

每次调用前必须回答：**这次调用会新增哪个 authority？它是否会消除当前最大的不确定性？**

- Repomix 的价值是“批量上下文复用”，不是出现一次名字；一个分析阶段优先复用同一 `outputId`。
- CodeGraph 的价值是“结构关系证明”，不是全文搜索；纯结构问题不必先制造无意义的文件读取。
- Local Dev 的价值是“当前执行真值”，不是替代 Context Plane 做 per-file 探索。
- Playwright/AX 的价值是“用户现实”，API/CLI/helper success 不能替代 screenshot/DOM/AX readback。
- Tool Runtime 的价值是恢复工具，不得把 runtime failure 升级成产品 failure。

## 3. 仓库任务：Repomix Context Plane

### 3.1 Context Scope Ladder：只决定“读多少”

Batch 流程始终相同，Context Ladder 只负责决定本批要读多大范围：

```text
S0 当前问题相关实现 + tests/config/package scripts 足以闭合
   → pack 最小相关目录 / owning package

S1 证据表明需要父目录或多 package
   → 只扩大到能解释新证据的边界

S2 证据确认 repo-wide / 全仓迁移 / 全仓一致性
   → 才扩大到 repo-wide
```

**范围升级必须由上一层证据触发。**scope 小不等于逐文件读，scope 大也不等于全量灌入上下文；两者都要求批量建立上下文并优先复用同一 `outputId`。

固定纪律：

- 最小充分 scope，一次 pack，多次 grep/read；不要每问一个问题重新 pack。
- `grep first, read second`；聚合输出用于定位和批量理解，不等于整包全文读取。
- 默认 `compress=false`；大范围先用 include/ignore/output patterns 去掉无关输入。
- `outputId` 是 pack 时刻快照；源码实质修改后以 Local Dev 当前磁盘/diff 为准。
- Repomix 负责批量上下文；caller/callee、composition、ownership、blast radius 交给 CodeGraph。
- package scripts / canonical verify command 属于 Batch Context 的必读内容，不能留到写后再猜。

## 4. Repomix 后的结构证明：CodeGraph Structure Plane

- 准备修改时先由 Repomix 在最小充分 scope 建立批量 Context；若涉及调用链、ownership、runtime composition、依赖与影响范围，再由 CodeGraph 精确证明。纯结构只读可以直接 CodeGraph；一旦转入修改，再进入统一 Batch 协议。
- `codegraph_explore` 已返回的 verbatim current-on-disk source 等价于 Read，禁止马上再 `read_file` 同一内容。
- dirty working tree 仍可用 CodeGraph 导航；若 graph 关系与当前磁盘冲突，以当前 source/diff 为真值，只把冲突节点视为 stale。
- 一个改动域原则上一次 explore；不要用多个小 query 模拟 grep loop。只有第一轮没有覆盖关键节点时才补第二次。

## 4.1 标准 Batch 状态机

任何仓库修改都按同一 Batch 状态机执行。文件数、目录层级和影响范围只改变 `BATCH_SCOPE`，不产生第二套修改流程：

```text
BATCH_CONTEXT
  → 建立最小充分上下文；本阶段只读，不写产品文件

BATCH_PLAN_FROZEN
  → 行为目标、文件白名单、验证命令、STOP POINT 已冻结
  → 到这里才允许写

BATCH_TRANSFORM
  → 一次 fail-closed transform 写完整批次

BATCH_VERIFY
  → 一次统一 gate；不逐文件 reread / 不每改一处跑一次 test

BATCH_CLOSEOUT
  → 裁决 LOCAL_PASS / FAIL；同步 CURRENT 或稳定 Runbook owner
```

**禁止 `BATCH_CONTEXT → 写一点 → 再读一点 → 再写一点`。**只有第一 Batch 的验证产生了新的机械 evidence，才允许开启第二 Batch。

### 4.2 写前必须冻结 Batch Contract

进入第一次 write/mutation 前，至少明确下面这些字段；可以在 Chat 中短报，不要求新建文件：

```text
BATCH_ID               = 本轮可辨识短名
BATCH_SCOPE            = owning package / 最小相关目录
PROBLEM                 = 当前唯一 blocker / 目标
CONTEXT_AUTHORITY      = Repomix outputId + 必要的 CodeGraph / Reality evidence
EXPECTED_CHANGED_FILES = 允许修改的 path whitelist
CHANGE_INTENT          = 每个文件为什么属于同一闭环
VERIFY_SOURCE          = package.json / owner Runbook / 当前机械 authority
VERIFY_COMMANDS        = targeted / full / typecheck / build / diff 中本批真正需要的命令
STOP_POINT             = release / Registry / Workspace / Browser / Owner mutation 前的停止点
```

经验规则：

- Context 阶段不仅要读实现/tests/config，也要把 **package scripts / canonical verify command** 一起冻结；“代码想清楚了但验证命令靠猜”仍然属于 Harness 不完整。
- `EXPECTED_CHANGED_FILES` 是 transform 白名单，也是 verify 的 changed-files 预期；批处理出现额外文件立即 STOP。
- `CHANGE_INTENT` 必须能用一句话描述同一行为闭环；如果需要两个无关目标，拆成两个 Batch。
- `STOP_POINT` 把幂等本地 gate 与 release/install/Browser/remote mutation 分开，不能为了少调用把非幂等步骤塞进一个巨型脚本。

### 4.3 Batch 失败分类与第二轮准入

Batch Verify 失败后先分类，不允许条件反射式再改源码：

| 分类 | 典型 evidence | 正确动作 | 是否允许改产品源码 |
|---|---|---|---|
| `HARNESS_FAILURE` | runner/命令写错、依赖工具不存在、path/参数错误 | 修正验证 Harness；源码未变时复用同一 Repomix outputId | 否 |
| `CANDIDATE_FAILURE` | targeted/typecheck/build/diff 明确由候选行为失败 | 从失败 evidence 反推最小 owner，开启第二 Batch | 是，第二 Batch |
| `NEW_AUTHORITY` | Browser/Registry/Owner/runtime 新现实改变原前提 | 先同步 CURRENT / tool route，再重新冻结 Batch | 视新 checkpoint |

Harness failure 不是“代码红灯”。例如 package 自己的 `test` script 已定义 runner 时，禁止绕过 package script 凭记忆拼一条新的 test 命令；若猜错，修 Harness，不污染产品实现。

### 4.4 聚合且透明的状态汇报

高吞吐不是黑箱执行。对用户只在有信息增益的状态迁移点汇报，格式尽量稳定：

```text
BATCH_STATE=PLAN_FROZEN
SCOPE=<...>
CONTEXT=<outputId / authority>
EXPECTED_FILES=<...>
VERIFY=<...>
STOP_POINT=<...>

BATCH_STATE=TRANSFORM_APPLIED
CHANGED_FILES=<...>

BATCH_STATE=LOCAL_PASS | FAIL
GATES=<targeted/full/typecheck/build/diff>
FAIL_CLASS=<HARNESS_FAILURE | CANDIDATE_FAILURE | NEW_AUTHORITY | none>
NEXT=<下一 authority / SAME SCENE / STOP>
```

不要汇报“刚 read 了 A、又 grep 了 B、现在准备 edit C”这种 tool-call 流水账；透明的是**当前 Batch 的 scope、证据、状态、失败类型和下一 stop point**。

## 5. Batch Read / Transform

`Batch` 描述执行形态，不描述文件数量。`EXPECTED_CHANGED_FILES=[A]` 和 `[A,B,C,...]` 都执行同一流程。

- **读：**优先 Repomix 同一 `outputId` / 一次 `read_multiple_files` 聚合相关实现、tests/config、package scripts；禁止 `read A → 想 → read B → 想`。CodeGraph 已返回的 current-on-disk source 视为已读。
- **写：**一次完成当前白名单的全部修改。底层可以是原子 edit 或 fail-closed Python/Node transform，但工具差异不产生新的修改流程。
- **写入护栏：**白名单 path、expected match 断言、失败即停、输出 changed-files、禁止 transform 内扩大 scope。

## 6. Batch Verify

修改完成后优先一次性验证，而不是逐文件 reread：

```text
git diff --check
git diff --name-only
changed + affected targeted test/typecheck/build
git diff -- <scope>
git status --short
```

是否跑 build / architecture / publishability 按本次 blast radius 决定；局部改动禁止无意义全仓 Gate。

若验证失败，先从失败 evidence 反推最小 owner，再补 CodeGraph/source inspection；不要直接重新扫描全仓。

## 7. 长任务与 process output

- 一次启动，保存本轮 PID/session；
- 合理间隔读取输出，禁止高频 `read_process_output`；
- 能从已完成/archived output 得到结果就不要重启；
- timeout/UNKNOWN 不等于失败，先判断 process / authority truth；
- publish/install/create/migration 等非幂等 mutation 绝不因超时盲重试。

这部分仍受 `基础动作/Round-PID-Log与恢复.md` 约束。

## 8. Reality Plane：Browser 不是仓库 Batch

Reality Plane 是真实 Browser/UI 的眼睛和手：普通 Web 用 Playwright，privileged Chrome/系统 UI 用 AX/Swift + screenshot。浏览器流程不能为了追求更少调用而合并成不可观察的大动作；**任何 UI 异常在第一次源码归因前原则上必须已经有当前 screenshot/snapshot/AX evidence**：

```text
observe / screenshot
→ one meaningful mutation
→ observe visible result
→ next mutation
```

高吞吐原则主要解决本地仓库的结构发现、读写和 Gate；真实 UI 仍以可观察、可恢复为优先。

## 9. 反模式

```text
禁止：CodeGraph → 再逐个 Read CodeGraph 已返回的文件
禁止：10 个文件 → 10 次 read_file
禁止：10 个文件 → 10～30 次 edit_block/write_file
禁止：仓库重构靠 write_file chunk append loop
禁止：每改一个文件就跑一次 test
禁止：长进程 1～2 秒一次轮询
禁止：验证失败后无差别重新扫全仓
```

## 9.1 效率异常诊断：Tool Call 变多时先改路由，不是加速低效循环

仓库任务没有固定“最多 N 次调用”的硬上限，Browser Journey 也必须保留动作后的观察。但如果往返明显增长而 authority 没有收敛，先暂停并检查：

```text
PER_FILE_READ_LOOP?        → 应否 Repomix 一次 pack + grep/read 或 read_multiple_files
STRUCTURE_GREP_LOOP?       → 应否 CodeGraph 一次覆盖 caller/callee/ownership/blast radius
REDUNDANT_SOURCE_READ?     → CodeGraph 已返回源码是否又被 Local Dev 原样重读
NO_REALITY_EVIDENCE?       → Browser/UI 问题是否还没有当前 screenshot/snapshot/AX tree
FRAGMENTED_VERIFY?         → 幂等 test/typecheck/build/diff 是否可一次 batch verify
AUTHORITY_RECHECK_LOOP?    → 是否在重复证明同一层事实，而没有升级到下一层未知
REPACK_LOOP?               → 同一分析阶段是否错误地反复生成 Repomix outputId
RUNTIME_PRODUCT_CONFUSION? → MCP/relay 故障是否被当成产品代码故障排查
```

优化目标是缩短 `现象 → authoritative evidence → owner → 最小修复 → SAME SCENE` 的总路径，同时保持证据密度，不以删除验证步骤换速度。

## 10. 每个 Batch 的自检

结束时快速检查：

```text
CONTEXT_PACK_COUNT         = 1（需要跨文件仓库理解/修改时；纯结构已知-symbol、纯机械、Browser 可为 0）
STRUCTURE_DISCOVERY_COUNT  ≈ 1
FULL_PACK_READ             = NO
REDUNDANT_REREAD           = 0（原则上）
PER_FILE_TOOL_LOOP         = NO
BATCH_TRANSFORM            = YES（任何修改）
BATCH_VERIFY               = YES
HIGH_FREQUENCY_POLL        = NO
OUT_OF_SCOPE_CHANGE        = 0
```

如果一个普通仓库修改已经出现十几到几十次 Tool Call，先停下来重构执行方式，不要继续用更快的节奏重复低吞吐模式。
