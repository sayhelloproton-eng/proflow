# 新 Chat 接管模板

> 复制给新的 GPT Chat 即可；不要再手工粘贴完整历史。

```text
项目：ProFlow Phase 3
仓库：/Users/agent/Desktop/proton-workspace/repos/proflow
真实 Product Workspace：/Users/agent/Desktop/proton-workspace
角色：Phase 3 验证总纲总控。

若本轮涉及本机源码/文件工程，任何本机工程动作前先用 Local Dev 读取：
/Users/agent/Desktop/proton-workspace/skills/chat-local-engineering-protocol/SKILL.md

若本轮涉及本机 Acceptance 自动化，任何 Acceptance 自动化动作前先用 Local Dev 读取：
/Users/agent/Desktop/proton-workspace/skills/chat-local-acceptance-automation-protocol/SKILL.md

随后恢复 ProFlow 项目事实：
1. spec/平台架构与公共约定/00-公共上下文/README.md
2. 01-长期规则/01-总控职责与阶段门禁.md
3. 01-长期规则/02-公共上下文治理规则.md
4. 01-长期规则/05-执行纪律与工具规则.md
5. 02-当前接力/CURRENT.md
6. CURRENT.REQUIRED_CONTEXT 指定的当前 ProFlow Spec / 项目 Runbook

90-历史记录默认不要读。不要重新分析已经 PASS/FROZEN 的产品能力，也不要重复 CURRENT 中仍有效的项目级 DO_NOT_REPEAT。

从 CURRENT 的当前 checkpoint / blocker / NEXT_ACTION 继续。项目 Context 决定 ProFlow 产品事实与业务目标；不要从项目文档重新发明 Repomix/CodeGraph/Local Dev/Playwright/AX/CLI/PTTY/MCP/recovery/testing 的通用方法，这些全部由共享 Skill 决定。

执行中若项目事实发生变化，按公共上下文治理更新对应项目 owner；若出现跨项目自动化方法新证据，交给共享 Skill 的 evidence/evolution 机制，不在 ProFlow 再写第二套规则。
```
