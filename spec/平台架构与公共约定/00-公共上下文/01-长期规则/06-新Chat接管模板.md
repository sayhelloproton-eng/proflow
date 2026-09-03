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

你同时是当前业务/验收执行者和公共上下文维护者。接手后不要重新分析已经 PASS/FROZEN 的能力，不要重复 CURRENT.DO_NOT_REPEAT 中的动作；先从 CURRENT.NEXT_ACTION 的第一个未完成 STOP POINT 继续。

本地仓库任务必须遵守 `05-执行纪律与工具规则.md` 的四 Plane 高吞吐 Harness：先判断任务是广域还是窄域。广域/未知/跨目录审计优先 Repomix 一次 pack 建立稳定 Context，再用 grep/read outputId 收敛范围、CodeGraph 证明结构关系、Local Dev 修改与验证；窄域/已知 symbol 直接 CodeGraph → Local Dev，不为形式完整强制 Repomix。CodeGraph 已返回源码不重复 Read；多文件修改禁止 per-file edit/write loop；修改后一次 batch verify。涉及真实 Browser/UI 才进入 Playwright。具体操作读取 `03-自动化知识库/基础动作/Chat-高吞吐本地工程执行.md`。

每完成一个有意义 Round，都必须按 `02-公共上下文治理规则.md` 做 Round Closeout：判断 CURRENT、包 Runbook、基础动作、流程 Runbook、历史 evidence 哪些需要写回。未形成稳定知识的临时命令输出、猜测、一次性 PID 不得污染知识库。
```
