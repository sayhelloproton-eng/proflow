# 新 Chat / Agent 接管模板

> 当前公共上下文已经吸收历史一次性交接。新 Chat 不再读取滚动 handoff；按 `README → 02 → 09 → 05` 接管，`10/12` 仅在追溯 Deployment 时读取。2026-09-02 当前完整流转提示词以 `09` 的 `## 14. 下一 Chat 流转提示词` 为准；Real-3 审计由 Work 执行，下一 Chat 只消费 Work 反馈并做总控裁决。

后续切 Chat 时，不复制完整历史。一般阶段的新 Chat 默认以 **Phase 3 验证总纲总控** 身份接管，而不是默认成为开发者或命令分发器。

```text
项目：ProFlow Phase 3
仓库：/Users/agent/Desktop/proton-workspace/repos/proflow
真实 Product Workspace：/Users/agent/Desktop/proton-workspace

你的角色：Phase 3 验证总纲总控。

先读取：
spec/平台架构与公共约定/00-公共上下文/README.md

然后严格按 README 最小读取顺序接管。
```

## 当前特殊状态（2026-09-02 / Real-3 审计前）

```text
DEPLOYMENT_TECHNICAL_MAINLINE = PASS
DEPLOYMENT_PRODUCT_ACCEPTANCE = PASS
DEPLOYMENT_SUCCESS = YES
DEPLOYMENT = FROZEN
CURRENT_EXECUTION_GATE = REAL_3_J0_J4
READY_FOR_REAL_3 = YES
REAL_3_PRE_AUDIT = ASSIGNED_TO_WORK
NEXT_CHAT_ROLE = VALIDATION_CONTROLLER / CONSUME_WORK_AUDIT
```

Deployment 已完成真实 npm latest + Fresh Product Workspace 最终验收，不再把 `09/10/12` 中的历史 Deployment blocker 当当前工作。新 Chat 的默认主线是 Real-3 Task Journey；只有出现新的可复现 regression evidence 才允许正式重开 Deployment。

Deployment 历史验收方法仍可作为未来发布/回归模板：真实 npm、公开 Platform CLI、真实 Browser/Tunnel/Model/Role、无内部 shortcut、失败后最小定位并回同场景重放。
## 接管后必须做

1. 机械确认 branch / HEAD / working tree；Registry/runtime 等易漂移事实只在真正需要时机械读取。
2. 读取 `02` 与 `09` 的 `0 / 0.1 / 0.2`，确认当前 Gate 是 Real-3 J0～J4，Deployment 仍 FROZEN。
3. 读取 `13-Real3-J0-J4纵向一致性审计任务书-20260902.md`，再读取 **Work 实际返回的审计报告/反馈**。
4. 不重复 Work 的整套纵向审计；只对关键 blocker、高风险 gap、可能的 Spec/Contract Conflict 做机械交叉确认。
5. 输出 `J0～J4 = ALIGNED | GAP`，并把 gap 分类为 `BLOCKER | NON_BLOCKING_GAP | SPEC/CONTRACT_CONFLICT`。
6. 冻结最小整改边界；当前领域正式 spec / Test Plan 仍是 normative truth，禁止用现有代码反向定义合同。
7. Implementation blocker 才进入代码整改；CodeGraph 先收敛结构/blast radius，Local Dev 做源码与 executable test 验证。
8. 若需要改变 Frozen Owner/State/Contract/Architecture，立即 STOP 进入正式 Spec/Contract Change。
9. 修复后先做 targeted regression，再进入真实 Real-3 J0～J4 Journey；真实 Journey 才能裁决 `REAL_3=PASS`。
10. 机器可确定/producer-owned 事实自动读取或执行，只有不可替代的人类动作才请求用户；单元测试、lint/build、exit 0 只能作为证据的一部分。

## 默认禁止

- 无 regression evidence 重开已经 PASS 的 Deployment / Real-1 / Real-2；
- 为测试变绿修改 Frozen Architecture / Owner / Contract；
- 把执行者“任务完成”直接等同总控验收 PASS；
- 用当前代码反向定义规范；
- 用 Mock / fake / 手工改内部状态替代真实 external reality；
- 未授权 git push、删除远端 Dev Tunnel、读取/输出 secret。

## 每轮结束只更新什么

阶段状态变化更新 `02`；当前机械事实/授权更新 `09`；Deployment `10` 已封版，不再滚动更新；当前 Gate/Next Action 由 `02/09` 维护；形成跨阶段永久执行规则更新 `05`。领域实现细节与 evidence 回领域文档，不继续新增滚动 handoff 文件。
