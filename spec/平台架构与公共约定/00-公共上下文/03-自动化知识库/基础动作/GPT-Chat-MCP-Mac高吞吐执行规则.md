# ProFlow｜Chat 本机工程协议兼容入口

> 通用执行 mechanics 的唯一 owner 已迁移到 workspace Skill：
> `/Users/agent/Desktop/proton-workspace/skills/chat-local-engineering-protocol/SKILL.md`

本文件保留原路径，避免旧 CURRENT/Runbook/历史引用失效；**不再维护第二套高吞吐理论**。原有详细理论与验证演进由 Git 历史保留。

## ProFlow overlay

- Browser/UI symptom 先取得 screenshot/snapshot/AX reality，再从源码猜 root cause。
- ProFlow 正式 Spec/Frozen Contract 仍决定产品“应该是什么”；Local Dev / Browser / Workspace readback 决定“现在是什么”。
- Repository modification 的执行 mechanics 统一继承共享 Skill；ProFlow 的 CURRENT 只决定当前 checkpoint、REQUIRED_CONTEXT、STOP 与项目特有 authority。
- `gptweb-mcp` runtime、manager、relay、Repomix sandbox、Playwright controlled group/token 等本机基础设施细节仍由同目录 `Tool-Runtime-gptweb-mcp.md` 拥有。
- Real-3 / Deployment / Package Update 等业务顺序仍由 ProFlow 对应流程 Runbook 拥有。

## 权威关系

```text
共享 Chat本机工程协议/SKILL.md  → 跨项目执行 mechanics
ProFlow Formal Spec              → 产品/架构/Contract
CURRENT                          → 当前 checkpoint
ProFlow Runbook                  → 项目特有动作/恢复
Local/Browser reality            → 当前机械事实
```

仓库内任何旧文档若重复 Engineering Decision、Batch、Verification Pyramid、低频 polling、Failure First 等通用规则，以共享 Skill 为准；项目规则只能增加更严格的边界。
