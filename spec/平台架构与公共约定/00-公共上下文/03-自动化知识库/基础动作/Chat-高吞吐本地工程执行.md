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

## 8. Reality Plane：Runtime / Browser Reality Batch

Reality Plane 不执行仓库 Batch，但**同样禁止逐动作试探**。高吞吐目标不是把多个 UI mutation 合成一个命令，而是把“观察/诊断”批量化，把 mutation 限定为冻结计划中的原子动作。

```text
REALITY_OBSERVE_BATCH
  → 一次收齐当前假设的 Browser + runtime + config/storage/log/Owner 只读 authority

REALITY_PLAN_FROZEN
  → 冻结 expected chain、FIRST_DIVERGENCE、允许动作、readback、STOP POINT

BOUNDED_ATOMIC_ACTIONS
  → 每个 UI/外部 mutation 仍独立执行；动作后立即 visible/Owner readback

AUTHORITY_READBACK
  → 用动作真正拥有的 authority 判定 PASS/FAIL，不拿 helper exit code 代替现实

REALITY_CLOSEOUT
  → SAME SCENE PASS，或由新的 FIRST_DIVERGENCE 开启下一 Batch
```

### 8.1 批量观察，而不是边看边猜

第一次 mutation 前，尽量在一个观察回合收齐当前假设需要的低风险只读事实。例如 Browser runtime/pairing 问题通常应一起看：当前 screenshot/AX 或 DOM、`platform status`、materialized runtime config、Browser storage、相关 runtime log/port/process。不要按 `看 UI → 写脚本 → 失败 → 再看 storage → 再写脚本` 的顺序推进。

### 8.2 FIRST_DIVERGENCE 是唯一诊断入口

先写出最短 expected chain，再找第一处分叉：

```text
materialized config
→ Extension bootstrap
→ Chrome storage
→ bridge hello/heartbeat
→ platform evidence/readiness
```

若 materialized config 已正确而 Chrome storage 不一致，当前 owner 就是 `materialized config → bootstrap/storage`；此时禁止继续 reload、setup、检查更后面的 Worker/Task 逻辑。后层失败只是前层分叉的派生症状。

### 8.3 Mutation 预算与换 Plane 规则

- 普通 Web：Playwright screenshot/snapshot → one canonical mutation → screenshot/DOM/Owner readback。
- privileged UI：fresh screenshot + identity/geometry → one canonical mutation → fresh screenshot → 后台 authority readback。
- canonical mutation 未产生预期 visible result：**STOP 同一操作路线**。除非 Runbook 明确规定唯一恢复动作，否则禁止临时发明第二种 AX/Swift/坐标/AppleScript/导航方案。
- `reload/restart/setup/recover` 不能拿来“看看会不会好”；只有 root-cause 假设要求它，且已冻结成功判据时才执行。
- 任何异常产生新 authority 后，重新冻结下一 Reality Batch；不要在旧计划里追加临时动作。

### 8.4 Runtime 也适用同一纪律

非 UI 的 service/runtime/pairing 排障同样先聚合 read-only facts，再做有限 mutation。优先一次读取 process/status/log/config/storage/port ownership，避免 `start → poll → stop → 改参数 → start` 的试探循环。长进程仍遵守“一次启动 + 合理间隔读取”，非幂等动作仍遵守 UNKNOWN 先恢复 authority。

### 8.5 纵向编排：State Trigger，不是步骤清单

`Batch` 解决同一阶段内的横向吞吐；跨阶段流程必须用 **authority state 触发下一 mutation**。执行前先写最短状态机，后一步只有在前一步机械状态成立时才获得执行许可：

```text
PRECONDITION_STATE
→ AUTHORITY_READBACK
→ ALLOWED_MUTATION
→ POSTCONDITION_READBACK
```

典型例子：

```text
Registry exact=PRESENT
→ 才允许 Workspace update

Workspace/materialized=target version
→ 才允许进入 setup

SETUP_STATE=WAITING_FOR_EXTENSION
→ 才允许 Reload / Load unpacked

Extension heartbeat/pairing=PASS
→ 才允许 platform start / SAME-SCENE J3

Dev Conversation NODE_READY 可见 + Owner generation exact
→ 才允许 startNode
```

禁止把“最终需要做 A、B、C”误写成“现在就依次执行 A→B→C”。若前序状态没有出现，后续 mutation 必须保持 `NOT_AUTHORIZED_YET`，先恢复缺失的 authority。

### 8.6 Real Hotfix Admission：先证明因果，再花 Release 成本

真实验收后半段最昂贵的浪费不是“多跑一个 test”，而是**把一个真实存在的旁支 bug 误当成当前 root cause，然后完整走一遍 release/adoption**。

每次准备发布 Real/SAME-SCENE hotfix 前，必须回答：

```text
CURRENT_RUNTIME_VERSION_PROVEN = YES ?
FIRST_DIVERGENCE               = 哪一层？
DEFECT_CAUSALLY_REPRODUCED      = YES ?
FIX_MOVES_THIS_DIVERGENCE       = 为什么？
POST_RELEASE_READBACK           = 用哪个 authority 证明？
```

任何一项答不出来，当前状态只能是 `VALID_DEFECT / HOTFIX_NOT_ADMITTED`。特别是 Browser Extension：在 Chrome actual runtime version 未证明前，禁止分析“新版本为什么没有执行”。

发布后若原 `FIRST_DIVERGENCE` 没移动，立即停止在该假设上追加补丁；新的现实证据优先于“这个代码 bug 看起来很像原因”。

### 8.7 总控与 Codex/领域执行器的高效分工

Codex/领域执行器最适合吃已经冻结的问题，不适合替代 Reality Authority：

```text
总控：真实现场 → root cause 证明 → blast radius → acceptance / stop point
执行器：批量实现 → tests/typecheck/governance → release candidate
总控：Registry / Workspace / Browser actual adoption → SAME-SCENE final acceptance
```

因此“Codex 执行过”带来的提速前提是**问题已经被压缩成可机械实现的 batch**。如果把未证明的现场假设直接交给执行器，执行速度再快也只会更快地产生错误 patch/release。执行器输出通过后也不得越级代替真实 Browser/Owner/Registry authority。

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
