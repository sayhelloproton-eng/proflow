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

Reality Plane   Playwright Chrome
  解决“真实浏览器里实际上发生了什么、用户最终看到了什么”
```

先分类任务，不机械串四层：

| 任务类型 | 默认第一入口 | 典型链路 |
|---|---|---|
| 首次接管大仓、目录/内容未知、跨目录文档/配置交叉审计、迁移覆盖 | Repomix | 最小相关范围 → 按证据扩父级/领域 → 必要时全仓 → CodeGraph → Local Dev |
| 已知 symbol/入口、单包局部 bug、明确调用链/依赖问题 | Repomix | pack 当前 package / 最小相关目录 → grep/read → CodeGraph → Local Dev |
| 当前文件代码理解/修改 | Repomix | pack owning package / 最小相关目录 → grep/read → 必要时 CodeGraph → Local Dev |
| 纯 Git/测试/命令、无需代码理解的已知机械动作 | Local Dev | Local Dev |
| Web UI、登录、授权、扩展、真实 ChatGPT 页面 | Playwright | Playwright 观察 → 必要时 CodeGraph/Local Dev 归因 → Playwright 复验 |

**判断标准不是“哪个工具更强”，而是谁能以最少往返消除当前最大的不确定性。**

## 3. 仓库任务：Repomix Context Plane

### 3.1 Progressive Context Ladder：从最小范围逐层拿文件

仓库上下文获取必须渐进，不允许“还不知道问题在哪里，就先把整个仓库读一遍”。固定阶梯：

```text
L0 已知 symbol / 已知文件 / 已知入口
   → Repomix pack owning package / 最小相关目录
   → grep/read 同一 outputId，先批量理解实现、测试、配置和邻接文件
   → 再进入 CodeGraph / Local Dev

L1 已知 package / 目录，内容未知
   → Repomix pack 该 package / 最小目录
   → grep → 小范围 read

L2 发现问题跨父目录 / 多 package / 一个领域
   → 向上扩大一级，或 includePatterns 只纳入相关区域
   → 继续 grep/read

L3 证据确认是 repo-wide / 全仓迁移 / 全仓一致性 / 首次全局架构审计
   → 才允许 full-repo pack
   → 仍然只 grep/read 命中片段，不全量读取聚合输出
```

**升级范围必须由上一层证据触发。**如果 L1 已经能回答问题，不进入 L2；如果相关 owner 已被 CodeGraph 定位，不为了“上下文更完整”再升到 L3。排障性能/稳定性时也使用同一方法：小目录 → 父目录 → packages/领域 → 全仓，记录每一级成功/失败与规模，先找拐点，再查原因。

Repomix 的核心收益不是单纯压缩，而是把“反复目录遍历 + 文件发现 + 重复读取”变成一个稳定的仓库上下文对象：

```text
pack_codebase(directory)
→ outputId
→ grep_repomix_output(outputId, pattern)
→ read_repomix_output(outputId, 精确行段)
```

固定纪律：

- **最小充分 pack，一次 pack，多次 grep/read**。先 pack 能回答当前问题的最小目录；只有上一层证据证明范围不足才扩大。同一分析阶段优先复用 `outputId`，不要每问一个问题重新 pack。
- **grep first, read second**。百万 Token 输出不是给 Chat 全量读取的；先 grep 找文件/术语/heading/符号，再读取几十到几百行局部。全仓 pack 即使成功，也不等于应该整包阅读。
- 默认 `compress=false`，利用完整 pack + 增量 grep/read；只有确实要把大范围骨架整体放进上下文时才启用 Tree-sitter compression。
- 大仓库先用 `includePatterns / ignorePatterns / outputPatterns` 控制输入域。能 pack 全仓不代表每次都应该 pack 全仓。
- `outputId` 是 pack 时刻的稳定快照，不是永远最新的磁盘真值。源文件在后续修改后，以 Local Dev 当前磁盘/diff 为准；跨越重大修改阶段继续做广域分析时再重新 pack。
- Repomix 适合回答“有哪些相关文件/文档/配置、哪些目录涉及某主题、跨版本/跨目录内容如何交叉比较”；**不负责证明 caller/callee、runtime composition、ownership 或 blast radius**，这些交给 CodeGraph。
- 已知单函数/单文件问题同样先用 Repomix，但 pack 范围只到 owning package / 最小相关目录；目的不是扩大阅读，而是一次批量获得实现、测试、配置和邻接上下文，避免后续 per-file read loop。

## 4. Repomix 后的结构证明：CodeGraph Structure Plane

- 仓库理解/修改任务先由 Repomix 在最小充分范围建立 Context；随后若涉及调用链、ownership、runtime composition、依赖与影响范围，再由 CodeGraph 精确证明。窄域也不跳过 Repomix，只缩小 pack 范围。
- `codegraph_explore` 已返回的 verbatim current-on-disk source 等价于 Read，禁止马上再 `read_file` 同一内容。
- dirty working tree 仍可用 CodeGraph 导航；若 graph 关系与当前磁盘冲突，以当前 source/diff 为真值，只把冲突节点视为 stale。
- 一个改动域原则上一次 explore；不要用多个小 query 模拟 grep loop。只有第一轮没有覆盖关键节点时才补第二次。

## 5. Batch Read

需要补读多个文件时：

```text
GOOD
read_multiple_files([A, B, C, D])

BAD
read_file(A)
read_file(B)
read_file(C)
read_file(D)
```

不要为了“确认一下”把 CodeGraph 已返回源码重新读一遍。修改后的确认优先依赖 diff + gate；只有精确内容仍不确定时才补读。

## 6. Batch Transform

当前 Local Dev 原子写工具偏向小修改，因此多文件任务不要让 Chat 自己循环 `write_file/edit_block`。

### 6.1 何时仍可用 edit_block

- 只改 1～2 个文件；
- 修改点少且可用唯一上下文精确匹配；
- 不会演化成连续十几个 tool call。

### 6.2 何时切换到单次 transform

满足任一条件就默认 batch：

- 修改文件数 > 2；
- 同一 rename / heading / import / reference 需要跨文件同步；
- 同一个逻辑修改包含多处 replacement；
- 文档迁移、目录整理、批量索引更新；
- 预计会出现 `edit A → edit B → edit C → ...`。

批处理脚本必须 fail-closed：

1. 明确允许修改的 path whitelist；
2. 对每个 expected old text / match count 做断言；
3. 任一断言不满足立即退出，不做“尽力而为”的模糊替换；
4. 输出 changed file list；
5. 不修改任务范围外的文件；
6. 若该 transform 会重复使用，再沉淀成仓库 helper；一次性动作无需污染产品源码。

推荐形态：

```text
start_process(一次 Python/Node transform)
  ├─ assert preconditions
  ├─ edit/create/rename N files
  ├─ print changed files
  └─ exit non-zero on mismatch
```

不要用 `write_file` 25～30 行 chunk loop 来完成几十/几百行的仓库重构。

## 7. Batch Verify

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

## 8. 长任务与 process output

- 一次启动，保存本轮 PID/session；
- 合理间隔读取输出，禁止高频 `read_process_output`；
- 能从已完成/archived output 得到结果就不要重启；
- timeout/UNKNOWN 不等于失败，先判断 process / authority truth；
- publish/install/create/migration 等非幂等 mutation 绝不因超时盲重试。

这部分仍受 `基础动作/Round-PID-Log与恢复.md` 约束。

## 9. Reality Plane：Browser 不是批量文件任务

Playwright Chrome 是真实 Browser/UI 的眼睛和手。浏览器流程不能为了追求 3～5 次调用而合并成不可观察的大动作：

```text
observe / screenshot
→ one meaningful mutation
→ observe visible result
→ next mutation
```

高吞吐原则主要解决本地仓库的结构发现、读写和 Gate；真实 UI 仍以可观察、可恢复为优先。

## 10. 反模式

```text
禁止：CodeGraph → 再逐个 Read CodeGraph 已返回的文件
禁止：10 个文件 → 10 次 read_file
禁止：10 个文件 → 10～30 次 edit_block/write_file
禁止：仓库重构靠 write_file chunk append loop
禁止：每改一个文件就跑一次 test
禁止：长进程 1～2 秒一次轮询
禁止：验证失败后无差别重新扫全仓
```

## 11. 每个 Batch 的自检

结束时快速检查：

```text
CONTEXT_PACK_COUNT         = 1（仓库理解/修改任务；窄域也为 1，只缩小范围；纯机械/Browser 可为 0）
STRUCTURE_DISCOVERY_COUNT  ≈ 1
FULL_PACK_READ             = NO
REDUNDANT_REREAD           = 0（原则上）
PER_FILE_TOOL_LOOP         = NO
BATCH_TRANSFORM            = YES（多文件时）
BATCH_VERIFY               = YES
HIGH_FREQUENCY_POLL        = NO
OUT_OF_SCOPE_CHANGE        = 0
```

如果一个普通多文件改动已经出现十几到几十次 Tool Call，先停下来重构执行方式，不要继续用更快的节奏重复低吞吐模式。
