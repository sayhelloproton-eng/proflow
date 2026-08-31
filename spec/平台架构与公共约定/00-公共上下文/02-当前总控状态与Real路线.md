# 当前总控状态、验证总纲总控职责与 Real 路线

> 更新时间：2026-09-01。这里记录 Phase 3 最终验收的 operational control state，不替代 Git / Registry / runtime 的实时机械检查，也不替代 Frozen Spec / Test Plan。

## 当前阶段

- `ARCHITECTURE = FROZEN`
- `SYSTEMATIC_NON_E2E_REMEDIATION = CLOSED`
- `READY_FOR_SMOKE = YES`
- `REAL_1 = PASS`
- `REAL_2 = PASS`
- `REAL2_PROVISIONING_GO = YES`
- `DEPLOYMENT_TECHNICAL_MAINLINE = PASS`
- `DEPLOYMENT_PRODUCT_ACCEPTANCE = PENDING_FINAL_LATEST_SMOKE`
- `DEPLOYMENT_SUCCESS = NOT_YET_FINAL`
- `CURRENT_EXECUTION_GATE = DEPLOYMENT_OPTIMIZATION_RELEASE_CLOSEOUT`
- `READY_FOR_REAL_3 = YES`（优化发布后的完整 latest Fresh Deployment E2E 完成后恢复 Real-3 主线）
- `SYSTEM_REAL_USABLE = OUT_OF_SCOPE_FOR_DEPLOYMENT`
- `PHASE3_FINAL_GO = NO`

2026-08-31 已在真实 npm latest + 真实 Product Workspace 上完成 Deployment **技术主链**：真实 setup/start/status、5 个 listener、Browser 0.1.21 真实加载 / pairing / heartbeat、Dev Tunnel HTTPS reality、FAST/THINK 真实推理、3 个 Custom GPT carrier 均已通过，`PLATFORM_READY=YES`。历史 repeat start 证据仅保留为既有工程事实，不属于当前/未来 Deployment E2E 必测项；当前收尾只保留 repeat setup、repeat status 与正常 stop → start → status。

当前 Deployment 验收的主测试角度固定为：**模拟第一次使用 ProFlow 的普通用户，以真实 npm 发布物 + 真实 Product Workspace + 公开产品入口执行系统端到端测试。** 总控可以在后台读取真实源码/状态来判断真值，但不能用这些开发者知识替普通用户绕过产品路径；任何修复最终都必须回到原用户 Journey 重放。

但 **Deployment Success 的最终产品验收口径不仅是技术主链跑通**。部署好还必须同时证明四个用户层维度：

1. **用户心智最低**：普通用户只需要理解 install / setup / start / status 和当前唯一动作，不需要理解 Module、shared facts、Tunnel ID、端口、owner、provider inventory 等内部实现。
2. **自动化部署最大化**：机器能发现、生成、复用、验证、恢复的事实必须自动完成；只把 OAuth/2FA/CAPTCHA/真实 secret/不可替代的人类决策交给用户。
3. **命令行交互好用**：每一步都明确“正在做什么 / 为什么停 / 用户只需做什么 / 完成后如何继续”，支持重入、取消、失败恢复，不让用户猜命令或内部状态。
4. **默认输出明确**：默认只暴露当前状态、唯一 root cause、下一步和最终结果；内部 traversal/dependency/owner 细节进入 verbose/doctor/日志。

因此当前状态必须区分：`DEPLOYMENT_TECHNICAL_MAINLINE=PASS`，但完整 `DEPLOYMENT_SUCCESS` 要等 O1～O6 优化版本发布后，在真实 npm latest + Product Workspace 上重新完成**完整、不可裁剪的普通用户 Fresh Deployment E2E**，并证明上述四项达到冻结标准。非阻断的小 polish 不反向推翻技术主链 PASS，但产品入口若仍要求用户理解内部实现、重复手工执行机器可做动作、交互含糊或默认输出误导，则完整 Deployment Product Acceptance 不得 PASS。

Deployment 优化裁决与真实 release 已完成。2026-09-01 仓库审计机械确认 Registry latest：`platform-cli=0.1.49`、`dev-tunnel=0.1.22`、`execution-browser-extension=0.1.22`；全局 `platform=0.1.49`。当前 Product Workspace 仍安装 `platform-cli=0.1.48`，且上一轮公共 `platform stop` 后当前 `status=2/3 / PLATFORM_READY=NO`（Tunnel runtime 已停止，Browser/Model 保持已配置）。审计收口后先原地升级 Product platform-cli 并从同一现场恢复验证，再进入最终 FULL FRESH 统一计时；收尾只保留 `repeat setup`、`repeat status`、正常 `stop → start → status`。

必须继续严格区分：

```text
DEPLOYMENT_SUCCESS != SYSTEM_REAL_USABLE
```

Deployment PASS 不代表 J0～J6 业务 Journey、协作/Approval/Effect、Browser/File/Phone Model 联合业务执行已经 PASS；这些继续按 Real-3～Real-6 验收。

## 验证总纲总控是什么

验证总纲总控是 Phase 3 最终验收阶段的最高 operational control 角色。它不是普通测试执行器、CLI 命令助手、单领域开发者，也不是被动汇总结果的记录员。

**名称消歧**：这里的“验证总纲总控”是 Phase 3 验收治理角色，存在于项目验证流程之外；它不等于 ProFlow runtime 内的 `agent-controller-dev`。前者负责验收调度与 STOP/GO，后者是被验收的业务 Agent Package。

第一职责是回答：**当前 Frozen 能力在真实环境里是否已经成立，是否允许进入下一 Real 阶段。**

## 总控固定职责

每个 Real 阶段开始前，总控必须明确：验收对象、PASS 条件、FAIL 条件、非目标与最短真实验证路径。

执行中，总控负责：

1. 控制当前只验收哪个 Real，禁止无证据跨阶段扩散；
2. 优先真实 Journey / external reality，不让结构测试替代真实验收；
3. 对失败先分类，再决定是继续人工动作、补 producer prerequisite、进入最小源码定位，还是 `STOP → SPEC_GAP / Contract Change`；
4. 若确认工程 blocker，限定 root owner、允许整改范围、回归测试 seam 与原场景重放要求；
5. 审查 Evidence，作出本阶段 `PASS / FAIL` 与下一阶段 `GO / NO-GO`；
6. 修复后要求最初失败场景真实重放，不能只凭 unit/lint/build 宣布闭环。

## 总控权力边界

总控拥有验收调度、STOP/GO、阶段门禁和整改边界控制权，但没有权力静默修改 Frozen Owner/State/Contract/Architecture。

如果正确验收只能通过改变 Frozen Contract 才能继续：立即 STOP，进入正式 `SPEC_GAP / CONTRACT_CONFLICT / EXTERNAL_BEHAVIOR_MISMATCH` 流程。

`真实 evidence` 可以证明实现不符合规范，也可以暴露规范假设需要正式变更；但 evidence、当前代码和测试绿灯都不能自行成为新的 normative truth。

## 固定 Real 路线

```text
Deployment latest mainline / Fresh revalidation       PASS
Optimization release + complete latest Fresh E2E      CURRENT CLOSEOUT
  ↓
Real-3  Task Journey J0～J4                            NEXT
  ↓
Real-4  Collaboration + Approval + Effect
  ↓
Real-5  Browser / File / FAST-REASON Phone Model
  ↓
Real-6  Recovery + J0～J6
  ↓
J0～J6 REAL PASS → PHASE3_FINAL_GO = YES
```

Real-1 / Real-2 已 PASS。后续只有新的、可复现真实 regression evidence 才允许重开；不能因为换 Chat、发现历史文档或顺手想再查而倒退。

每个 Real 终局必须明确写成：

```text
REAL_N = PASS | FAIL
READY_FOR_REAL_N_PLUS_1 = YES | NO
```

证据不足时不得用“基本完成/结构上通过/应该可以”代替终局裁决。
