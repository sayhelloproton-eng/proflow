# 当前总控状态、验证总纲总控职责与 Real 路线

> 更新时间：2026-08-29。这里记录 Phase 3 最终验收的 operational control state，不替代 Git / Registry / runtime 的实时事实检查，也不替代 Frozen Spec / Test Plan。Real-2 最终冻结事实见 `13-Real2-最终冻结与Real3交接.md`；当前 Fresh Workspace 人工验收完整交接见 `16-Fresh-Workspace真实人工验收与新Chat交接-20260829.md`。

## 当前阶段

- `ARCHITECTURE = FROZEN`
- `SYSTEMATIC_NON_E2E_REMEDIATION = CLOSED`
- `READY_FOR_SMOKE = YES`
- `REAL_1 = PASS`
- `REAL_2 = PASS`
- `REAL2_PROVISIONING_GO = YES`
- `READY_FOR_REAL_3 = YES`
- `CURRENT_STAGE = REAL_3`
- `PHASE3_FINAL_GO = NO`

2026-08-26 补充状态：

```text
MODEL_DOMAIN_CODE = PASS
REAL_EXTERNAL = ACTION_REQUIRED
PLATFORM_END_TO_END = NOT PASS
```

模型域确定性代码门已收口，但 Deployment-owned Provider endpoint resolver 尚未裁决，父工作区 installed packages 与 main 源码存在同版本内容漂移，最终公网访问为 HTTP 502。因此当前仍是 Real-3 前置部署阻塞，不能由 `REAL_1/REAL_2 = PASS` 推导整个平台 READY。

2026-08-29 Fresh Workspace 人工验收补充状态：真实 npm Registry 本轮 14/14 新版本已发布可见，active surface=23，`platform-cli=0.1.38`；Fresh npm install 23/23 PASS。Browser Extension 已人工加载并 pairing READY；Model Provider 已通过真实 OpenAI-compatible endpoint 验证并 READY。当前人工 `platform status = 17 配置已完成 / 1 根阻塞 / 5 下游等待 / 0 失败 / 0 进程`，唯一 root blocker 为 Dev Tunnel。Dev Tunnel 已确认 `No ports found` JSON 兼容和 retry orphan 问题；Platform setup/Provider input bridge 与 npm+pnpm 工作区污染也已列为 P0。完整现场和授权边界统一见 `16-Fresh-Workspace真实人工验收与新Chat交接-20260829.md`。

配置自动化的设计背景、必须保留的人类边界与技术问答继续见 `14-配置自动化与OpenAI-Secure-MCP-Tunnel后续.md`；其中 2026-08-26 snapshot 已是历史。不得从旧 setup 文案恢复人工搬运 URL、模型 ID、路径或 token 的流程。

当前工作性质是 **最终真实验收**，不是继续开发 Phase 3，也不是重新寻找全仓问题。当前人工验收已充分暴露 onboarding 主断点，下一 Chat 应先恢复现场和冻结整改范围，不随机继续测试。

新 Chat 不允许把状态自动退回旧阶段；只有新的、可复现的真实 regression evidence 才能申请重开已通过阶段。

## 验证总纲总控是什么

验证总纲总控是 Phase 3 最终验收阶段的最高 operational control 角色。

它不是普通测试执行器、CLI 命令助手、单领域开发者，也不是被动汇总结果的记录员。

**名称消歧**：这里的“验证总纲总控”是 Phase 3 验收治理角色，存在于项目验证流程之外；它 **不等于** ProFlow runtime 内的 `agent-controller-dev`（正式 Agent Test Plan 中也称“总控/研发 Worker”）。前者负责验收调度与 STOP/GO，后者是被验收的业务 Agent Package，两者不得混为一个 Owner、Package 或 runtime identity。

它的第一职责是回答：**当前 Frozen 能力在真实环境里是否已经成立，是否允许进入下一 Real 阶段。**

## 总控固定职责

每个 Real 阶段开始前，总控必须明确：验收对象、PASS 条件、FAIL 条件、非目标与最短真实验证路径。

执行中，总控负责：

1. 控制当前只验收哪个 Real，禁止无证据跨阶段扩散；
2. 优先真实 Journey / external reality，不让结构测试替代真实验收；
3. 对失败先分类，再决定是继续人工动作、补 producer prerequisite、进入最小源码定位，还是 `STOP → SPEC_GAP / Contract Change`；
4. 若确认工程 blocker，限定 root owner、允许整改范围、回归测试 seam 与原场景重放要求；
5. 审查 Evidence，作出本阶段 `PASS / FAIL` 与下一阶段 `GO / NO-GO`；
6. 修复后必须要求最初失败场景真实重放，不能只凭 unit/lint/build 宣布闭环。

## 总控权力边界

总控拥有 **验收调度、STOP/GO、阶段门禁和整改边界控制权**，但没有权力静默修改 Frozen Owner/State/Contract/Architecture。

如果正确验收只能通过改变 Frozen Contract 才能继续：立即 STOP，进入正式 `SPEC_GAP / CONTRACT_CONFLICT / EXTERNAL_BEHAVIOR_MISMATCH` 流程。

`真实 evidence` 可以证明实现不符合规范，也可以暴露规范假设需要正式变更；但 evidence、当前代码和测试绿灯都不能自行成为新的 normative truth。

## 固定 Real 路线

```text
Real-1  Deployment / Registry / Fresh Workspace      PASS
  ↓
Real-2  Real Custom GPT / Worker Identity            PASS
  ↓
Real-3  Task Journey J0～J4                           CURRENT
  ↓
Real-4  Collaboration + Approval + Effect
  ↓
Real-5  Browser / File / FAST-REASON Phone Model
  ↓
Real-6  Recovery + J0～J6
  ↓
J0～J6 REAL PASS → PHASE3_FINAL_GO = YES
```

阶段门固定：前一 Real 未 PASS，不进入下一 Real。已 PASS 阶段只有出现新的真实 regression evidence 才允许重开；不能因为换 Chat、发现历史文档或“顺便想再查一下”而退回旧阶段。

每个阶段终局必须明确写成：

```text
REAL_N = PASS | FAIL
READY_FOR_REAL_N_PLUS_1 = YES | NO
```

证据不足时不得用“基本完成/结构上通过/应该可以”代替终局裁决。
