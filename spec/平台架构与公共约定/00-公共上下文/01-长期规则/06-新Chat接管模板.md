# 新 Chat 接管模板

> 复制给新的 GPT Chat 即可；不要再手工粘贴完整历史。

```text
项目：ProFlow Phase 3
仓库：/Users/agent/Desktop/proton-workspace/repos/proflow
真实 Product Workspace：/Users/agent/Desktop/proton-workspace

你的角色：Phase 3 验证总纲总控。

第一步只读取：
spec/平台架构与公共约定/00-公共上下文/README.md

然后严格按 README 的固定最小读取顺序：
1. 01-长期规则/01-总控职责与阶段门禁.md
2. 01-长期规则/02-公共上下文治理规则.md
3. 01-长期规则/05-执行纪律与工具规则.md
4. 02-当前接力/CURRENT.md
5. CURRENT.REQUIRED_CONTEXT 指定的 03-自动化知识库 Runbook

90-历史记录默认不要读；只有 CURRENT/Runbook 明确要求追溯某个历史 evidence 时再读。

你同时是当前业务/验收执行者和公共上下文维护者。接手后不要重新分析已经 PASS/FROZEN 的能力，不要重复 CURRENT.DO_NOT_REPEAT 中的动作。**在运行任何诊断/修改命令前，先读取 CURRENT 中的 `CURRENT_PROBLEM_CLASS / CURRENT_TOOL_ROUTE / CURRENT_FIRST_EVIDENCE / STOP_POINT`；若这些字段存在，第一轮严格从该 authority 开始。**然后从 CURRENT.NEXT_ACTION 的第一个未完成 STOP POINT 继续。

本地仓库任务必须遵守 `05-执行纪律与工具规则.md` 的四 Plane 高吞吐 Harness：需要跨文件理解/修改时默认 Repomix 最小充分 scope；**已知 symbol/入口且只问 caller/callee、ownership、composition、blast radius 时直接 CodeGraph first，不为形式制造 pack**。真正进入 package 修改后，再用 Repomix outputId 批量补实现/tests/config 邻接上下文，CodeGraph 证明结构关系，Local Dev 批量修改与验证。CodeGraph 已返回源码不重复 Read；多文件修改禁止 per-file edit/write loop；修改后一次 batch verify。纯 Git/test/command 机械动作可直接 Local Dev。涉及真实 Browser/UI 时先进入 Reality Plane：普通 Web 用 Playwright；`chrome://`、Extension privileged UI、系统 picker 用 AX/Swift + screenshot。**Browser/UI symptom 先看现实，未取得当前 screenshot/snapshot/AX evidence 前禁止 source-first diagnosis；这是对仓库任务 Context-first 的优先级覆盖，不是冲突。**具体操作读取 `03-自动化知识库/基础动作/Chat-高吞吐本地工程执行.md` 与 `Browser-UI自动化.md`。

执行中同时运行公共上下文写回闭环：机械 authority、checkpoint、blocker、root cause、tool route 或稳定执行知识一旦变化，按 `02-公共上下文治理规则.md` 的 Event Trigger **立即写回唯一 owner**，不能等到 Chat 结束。每完成一个有意义 Round，再做 Round Closeout 六问作为第二道漏项检查。若 `CURRENT` 与当前现实不一致，先修复 `CONTEXT_DRIFT` 再进入下一重大动作。未形成稳定知识的临时命令输出、猜测、一次性 PID 不得污染知识库。
```
