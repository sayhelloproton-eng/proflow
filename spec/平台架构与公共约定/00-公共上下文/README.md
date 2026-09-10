# ProFlow Phase 3｜GPT Chat 公共上下文入口

> 目的：让新的 GPT Chat 在旧 Chat 上下文耗尽后恢复 **ProFlow 产品事实与当前 checkpoint**，而不是重新学习项目或重新发明本机自动化方法。

## 0. ChatGPT Chat 共享协议边界

```text
Local Engineering
→ /Users/agent/Desktop/proton-workspace/skills/chat-local-engineering-protocol/SKILL.md

Local Acceptance Automation
→ /Users/agent/Desktop/proton-workspace/skills/chat-local-acceptance-automation-protocol/SKILL.md
```

这两个 Skill 分别是 ChatGPT Chat 本机工程 mechanics 与本机 Acceptance 自动化 mechanics 的唯一规范真源。ProFlow 公共上下文只拥有产品/项目事实、Frozen Contract、当前 checkpoint、项目特有 identity、业务流程、PASS/FAIL 条件与安全边界；不再维护第二套 Browser / CLI / PTY / MCP / runtime / timeout / UNKNOWN / recovery / testing / logging / tool-routing SOP。

**Chat 高吞吐本机工程没有 ProFlow 项目内第二 owner、兼容规则文件或历史正文副本；当前执行统一直接读取 Engineering Skill。**

历史项目文档若仍描述上述通用 mechanics，只作项目历史/场景证据；与当前共享 Skill 冲突时，以共享 Skill 为准。ProFlow Formal Spec 与当前机械 reality 仍分别回答“应该是什么”和“现在是什么”。

## 1. 公共上下文四层结构

```text
01-长期规则      ProFlow 低频稳定的产品/项目铁律与治理边界
02-当前接力      CURRENT 唯一滚动项目状态、checkpoint、blocker、next action
03-自动化知识库  兼容路径：只保留 ProFlow 项目特有的包事实、产品动作、Journey/Flow 与阶段证据
90-历史记录      已结束 Round、旧 handoff、事故、审计和原始 evidence；默认不加载
```

`03-自动化知识库` 的旧名称保留是为了路径兼容，不代表它继续拥有跨项目自动化协议。通用 Primitive 文件已降级为共享 Skill 的兼容指针；高吞吐工程旧项目文件已删除，由 Git history 保留演进过程。

## 2. 真源与冲突顺序

```text
ProFlow Formal Spec / Frozen Contract → 产品规范上应该是什么
当前 Git / Registry / Workspace / Owner / Browser / runtime reality → 当前实际上是什么
01-长期规则                         → ProFlow 项目不可越界边界
CURRENT                             → 当前 checkpoint / blocker / next action
03 项目 Runbook                     → ProFlow 特有包/产品/Journey 事实与顺序
共享 Engineering / Acceptance Skill → ChatGPT Chat 如何执行本机动作
90-历史记录                         → 只解释过去为什么
```

同一句通用自动化规则在项目里出现多次不会获得额外权威；项目文档不得覆盖共享 Skill 的执行方法。共享 Skill 也不得覆盖 ProFlow Formal Spec 的产品语义。

## 3. 新 Chat 固定最小读取顺序

1. 本 `README.md`。
2. `01-长期规则/01-总控职责与阶段门禁.md`。
3. `01-长期规则/02-公共上下文治理规则.md`。
4. `01-长期规则/05-执行纪律与工具规则.md`。
5. `02-当前接力/CURRENT.md`。
6. 严格按 CURRENT 的 `REQUIRED_CONTEXT` 加载当前 ProFlow Spec / 项目 Runbook。
7. 只有需要追根因/审计原始证据时才读 `90-历史记录`。

涉及本机源码/文件工程时，必须先按 Engineering Skill；涉及真实 Browser/UI、CLI/PTTY、MCP/runtime、认证、恢复或真实用户 Journey 的 Acceptance 自动化时，必须先按 Acceptance Skill。不要从项目 Runbook 重新推导这些通用 mechanics。

## 4. ProFlow 项目知识路由

项目特有包/外部资源：

- Dev Tunnel 产品事实、稳定 identity 与 ProFlow 使用约束 → `03-自动化知识库/包能力/dev-tunnel.md`
- ProFlow Execution Browser Extension 产品事实/identity/adoption → `包能力/execution-browser-extension.md`
- platform CLI 产品 contract → `包能力/platform-cli.md`
- Model Provider 产品 runtime contract → `包能力/model-provider-runtime.md`
- Custom GPT / Role / Worker 产品 identity → `包能力/custom-gpt-provisioning.md`

项目特有流程：

- Deployment 产品 Journey → `流程/Deployment-Fresh.md`
- 单包修复/发布/Workspace adoption 的 ProFlow 产品流程 → `流程/Package-Update-Loop.md`
- Real-3 J0～J4 产品 Journey/checkpoint → `流程/Real3-J0-J4.md`

旧通用入口 `00-自动化模拟人工总原则.md`、`Browser-UI自动化.md`、`CLI-PTY交互自动化.md`、`Round-PID-Log与恢复.md`、`Tool-Runtime-gptweb-mcp.md` 只保留兼容指针，不再拥有方法正文。Chat 高吞吐本机工程旧入口不再保留，直接使用 Engineering Skill。

## 5. 维护规则

CURRENT 只保存当前项目事实，不无限追加过程。项目特有稳定知识进入对应 ProFlow package/flow 文档；Formal Contract/Test Plan 变化回正式 `spec/`；原始事故 evidence 进入 `90-历史记录`。

跨项目 Engineering 或 Acceptance 自动化经验不得再写成 ProFlow 第二真源；应进入对应共享 Skill 的 evidence/evolution 路径。重大 Frozen Contract、Owner/State 变化仍必须按 ProFlow 治理和用户裁决处理。
