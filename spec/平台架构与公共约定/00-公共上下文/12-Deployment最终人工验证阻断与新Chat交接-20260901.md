# Deployment 最终人工验证阻断与新 Chat 交接

> 日期：2026-09-01
> 仓库：`/Users/agent/Desktop/proton-workspace/repos/proflow`
> Product Workspace：`/Users/agent/Desktop/proton-workspace`
> 用途：本次是用户明确要求的一次性紧急 handoff，优先级高于旧滚动上下文。

## 0. 2026-09-01 最新覆盖（高于本文后续历史段落）

本文第 1～15 节保留 P1 发现时的历史现场；当前执行必须先采用本节最新机械事实：

```text
P1 irreversible GPT Role rollback/recreate
= 已修复合同与实现
= 真实 npm 已发布
= SAME SCENE 已恢复 3/3 原 Role/GPT
= 不再是当前 blocker

platform-cli external-resource temporary start
= 0.1.50 已真实发布并进入 Product Workspace

dev-tunnel start public HTTPS/TLS readiness
= 0.1.23 已真实发布并进入 Product Workspace

agent-runtime transient Action probe retry
= 0.1.13 已真实发布并进入 Product Workspace
```

真实 npm `agent-runtime@0.1.13` 已在原 SAME SCENE 再次执行 canonical `platform setup` 并 `HUMAN_SETUP_RC=0`，3/3 核心配置完成，3 个原 Role/GPT 保持不变。因此此前单次 `GATEWAY_HEALTH_UNREACHABLE` 定性为未复现的外部瞬时现象，不再作为 Deployment blocker；实验性 health retry 已精确撤回，不发布 `agent-runtime@0.1.14`。

当前唯一可重复 blocker 出现在冻结验收要求的 `platform stop → platform start → status`：真实 npm `dev-tunnel@0.1.23` 冷启动连续两次在 `dev-tunnel` 失败。后台权威诊断确认真实安装包所管理的 `.devtunnel/1.0.2030/.../devtunnel` 文件已不存在，执行得到 `ENOENT`；`setup()` 会调用 `resolveDevTunnelCli()` 自动重新获取 CLI，但 `start()` 直接使用 `devTunnelCliPath()`，所以将 ENOENT 折叠成 `login=UNKNOWN` 并误报 `Microsoft Dev Tunnel login is not ready`。当前最小修复：`start()` 先通过 owner resolver 确保 managed CLI 存在，再创建 runtime；针对回归测试与 typecheck 已 PASS，待真实 npm patch release 后重放 stop→start→status。

从现在起执行规则以 `05 §4.10` 为最高优先级：**真实 npm only；禁止 local tarball/link/workspace shortcut 作为 Deployment 验收；昂贵 release 前一次性检查完整失败层；默认 targeted test + typecheck；SAME SCENE PASS 后立即 FULL FRESH；FULL FRESH 主链 PASS 即 `DEPLOYMENT_SUCCESS=YES` 并结束 Deployment，不再做瑕疵扩展。**



**Deployment 禁止 tarball 硬规则（用户再次明确，2026-09-01）：** 从现在起，Deployment Closeout 的调试、SAME SCENE、模拟人工验收、Product Workspace 验收、FULL FRESH 最终证明，**一律禁止使用 local tarball / `npm pack` 产物 / 本地 `.tgz` / `npm link` / workspace symlink / repo source override 代替真实 npm Registry 包**。即使只是“为了更快先验证一下”，也不允许把 tarball 引入当前 Deployment 主线。修复必须先完成 targeted test + typecheck，再真实发布到 npm Registry，随后只用 Registry exact/latest 安装物重放。若未来某个执行者认为 tarball 更快，必须忽略该想法并继续真实 npm 路径；除非用户以后明确撤销本规则。

当前唯一下一动作：

```text
dev-tunnel start managed CLI reacquisition 修复
→ targeted regression + typecheck
→ 真实 npm patch release（预计 dev-tunnel 0.1.24）
→ Registry exact/latest readback
→ Product Workspace 安装真实 npm 版本
→ 直接重放 stop → start owner → status
→ lifecycle PASS 后立即 FULL FRESH
```

## 1. 下一 Chat 的唯一目标

不要重新做仓库总审计，也不要重新优化 Browser/GPT 自动化。

唯一目标：

```text
修复最终 Fresh 人工模拟验证中发现的 P1
→ 证明不会因为 Carrier live validation 瞬时失败而重复创建 Custom GPT
→ 从当前 SAME SCENE 安全恢复
→ 再跑最后一次 Fresh Deployment
→ 满足标准后裁决 DEPLOYMENT_SUCCESS=YES 并结束 Deployment 阶段
```

P1 修完之前：`DEPLOYMENT_SUCCESS=NO`。

## 2. 进入本轮前已完成的基线

Deployment 在上一轮曾完整 PASS，并已落库：

```text
a80547e test(e2e): close deployment acceptance
```
当时已验证：

```text
platform-cli source/product/Registry = 0.1.49
dev-tunnel source/product/Registry = 0.1.22
execution-browser-extension source/product/Registry = 0.1.24
Browser canonical human-E2E harness = 稳定
FULL FRESH Browser install = PASS
Dev Tunnel = PASS
Model FAST / THINK = PASS
3 GPT / Identity = 曾完整 PASS
start/status/repeat setup/stop/restart = PASS
backstage runtime / tunnel probe = PASS
```

关键已有提交：

```text
6a1fd0f docs(test): record browser harness failure lessons
a6e09e5 test(e2e): stabilize browser human automation harness
82fda67 fix(browser): stabilize setup readiness after pairing
# Browser 0.1.24 后续已真实发布并进入 a80547e 最终基线
a80547e test(e2e): close deployment acceptance
```

不要重新发明 Browser helper。

## 3. 用户冻结的部署成功标准

部署成功不是 `exit 0`，也不是某几个服务启动。
最终标准：

```text
真实 npm Registry latest
+ Fresh Product Workspace
+ 公开 platform install/status/setup/start/stop
+ Browser/Tunnel/Model/3 GPT 真实成立
+ 自动化最大化、最低用户心智
+ CLI 根因/下一步清晰
+ 可安全 repeat/recovery
+ runtime reality 与 evidence 一致
= DEPLOYMENT_SUCCESS
```

最终人工模拟只记录真正影响上述标准的问题；不要为找问题而找问题，不做瑕疵审计。

## 4. 最后一遍真实 Fresh 人工模拟发生了什么

最后一次从 Fresh 真实 Registry latest 开始，安装成功：

```text
Fresh Workspace = PASS
platform install = 23/23 PASS
initial platform status = 0/3，正确，无假 READY
Browser Fresh install = PASS
```

Dev Tunnel 首次 setup 曾报：

```text
publicBaseUrl is not reachable over HTTPS
```
但它安全停在 `HOST_READY`，没有重复创建 Tunnel；按 CLI 提示重新 `platform setup` 后原地恢复成功。

因此 Tunnel 这一点定性为：**外部/远端瞬时波动，恢复机制正确，不是当前 P1。**

之后：

```text
Browser = READY
Dev Tunnel = READY
Model FAST / THINK = READY
前两个 Agent Role = READY
第三个 agent-test-ops = FAIL
```

失败信息：

```text
ROLE_CARRIER_VALIDATION_FAILED:GATEWAY_HEALTH_UNREACHABLE
```

最终权威读回：

```text
platform status:
核心配置 3/3
Browser / Tunnel / Model 均完成
但 ROLE_NOT_REGISTERED:@tomflow/proflow-agent-test-ops
PLATFORM_READY=NO

role store = 2 条
role credential store = 2 条
public Gateway /health = 502
public Gateway /ready = 502
```

注意：核心 `3/3` 不等于平台最终 READY；Role 2/3 是真实 blocker。
## 5. P1 的已确认根因

核心源码链：

```text
agent-*/deployment/adapter.ts
→ createCustomGptRole(...)
→ host.provisionPackage(...)        # 远端 GPT 已真实创建
→ roleRegistry.saveRole(...)        # 本地 Role 保存
→ inspectRole(...)                  # 本地持久化校验
→ verifyCarrier(...)                # 公网 Gateway /health + Action probe
→ 若失败进入 catch
→ rollbackSavedRole()               # 本地 Role 被回滚
→ 远端 GPT 不会被删除
```

关键文件：

```text
packages/execution-browser-extension/src/custom-gpt-role.ts
packages/agent-runtime/src/role-management-client.ts
packages/agent-controller-dev/deployment/adapter.ts
packages/agent-product/deployment/adapter.ts
packages/agent-test-ops/deployment/adapter.ts
packages/platform-cli/src/lifecycle/thin.ts
```

`platform setup` 已经存在 agent-package 的 temporary runtime dependency 机制，所以不要简单下结论为“setup 完全没有启动 Gateway”。

真正确定的问题是：**不可逆远端创建之后，把瞬时 live validation 当作可回滚事务的一部分。**
这会形成危险恢复链：

```text
远端 GPT 已创建
→ Carrier 瞬时失败
→ 本地 Role rollback
→ status 看见 Role=MISSING
→ CLI 提示重新 platform setup
→ 再次 create
→ 可能产生重复 GPT
```

这是当前唯一必须修的 Deployment blocker。

## 6. 当前 SAME SCENE 的重要安全边界

**现在不要直接重新运行 `platform setup`。**

原因：第三个 test-ops 的远端 GPT 可能已经创建成功，但本地 Role 已被 rollback；盲目重跑可能再创建一份。

下一 Chat 必须先恢复远端/本地 authority：

1. 只读确认当前 Product Workspace Role store 仍是 2 条。
2. 不输出任何 role credential / token / secret。
3. 确认 ChatGPT 远端是否存在本轮刚创建但未注册的 test-ops GPT。
4. 若能通过已有 authoritative readback 安全恢复其 ID，则优先 reconcile，不再 create。
5. 若没有安全 readback，只能明确处理这一个 orphan 后再继续；禁止盲目 create。

不要因为想快速通过而跳过这一点。
## 7. 刚才被用户叫停时留下的 WIP

`packages/agent-runtime/src/role-management-client.ts` 当前已经有**未完成、未测试**的草稿修改。

已出现的新增内容包括：

```text
RoleCarrierValidationEvidenceInput
roleCarrierValidationEvidencePath(...)
hasCurrentRoleCarrierValidationEvidence(...)
recordRoleCarrierValidationEvidence(...)
```

以及新增 imports：

```ts
mkdir, rename, writeFile
dirname
```

该草稿意图是把 Carrier live-validation 证据独立持久化，证据只保存：

```text
agentPackageRef
registeredPackageVersion
roleRef
carrierUrl
gatewayUrl
validatedAt
```

不保存 credential。

**这只是 WIP，不是已完成设计，也没有 Gate。**
下一 Chat 第一件事必须是：

```text
git diff -- packages/agent-runtime/src/role-management-client.ts
```

然后结合正式 spec/Test Plan 决定：完成这套 evidence 设计，还是撤回重做；不要在不理解 dirty diff 的情况下继续叠代码。

## 8. 推荐修复方向（需用正式 spec 交叉裁决）

目标不是“让测试通过”，而是保证不可逆远端资源的恢复安全。

推荐状态机：

```text
远端 GPT LIVE_CREATED
→ 本地 Role/credential 持久化成为不可丢失 authority
→ Carrier live validation 单独作为可重试状态/证据
→ validation transient fail 时保留 Role，不重新 create
→ 再次 setup 只 retry validation
→ validation PASS 后写 evidence
→ status 才进入最终 READY
```

最低必须满足：

1. `LIVE_CREATED` 之后的 transient Gateway probe 失败不能让系统忘掉刚创建的 GPT。
2. `platform setup` 重入时必须识别已创建 Role，不再次调用创建浏览器流程。
3. Carrier bearer/action validation 仍必须真实存在，不能为了避免失败直接删除验证。
4. validation evidence 不得保存 secret。
5. role/package/gateway 发生 drift 时旧 evidence 必须自动失效。
## 9. 必须补的回归测试

至少覆盖：

```text
A. create 成功 + save 成功 + carrier validation 失败
   → 不得丢失新 Role authority
   → 不得形成下一次 create 条件

B. 已存在 Role + validation evidence 缺失/失败
   → setup 只 retry validation
   → createCustomGptRole 不再执行

C. validation PASS
   → evidence 原子落盘
   → status READY

D. roleRef/packageVersion/carrierUrl/gatewayUrl 任一变化
   → evidence stale
   → 重新 validation，但仍不得重建 GPT

E. credential 不得出现在 evidence / CLI 输出
```

重点回归文件：

```text
packages/execution-browser-extension/tests/custom-gpt-role.test.ts
packages/agent-runtime/tests/role-management-client.test.ts
packages/agent-*/tests/*deployment* / *static*
packages/deployment-conformance/tests/setup-assistant.test.ts
```

只跑 affected package Gate；到阶段末再跑一次全仓 Gate。

## 10. 浏览器自动化绝对禁止事项
用户已冻结：**Custom GPT / 智能提示创建浏览器操作不要动。**

禁止修改：

```text
点击顺序
selectors
等待策略
创建流程
create-only 语义
并发/串行策略
stable browser operation
```

Browser Extension 安装/卸载 human-E2E 也已经有唯一 canonical helper：

```text
scripts/human-e2e/browser-extension-ui.swift
scripts/human-e2e/browser-extension-ui.mjs
scripts/human-e2e/platform-setup.exp
```

不要再写 `/tmp/*.swift`、临时 expect 或第二套 UI helper。

PTY 经验已冻结：Expect 必须在 child PTY 内设置正常 rows/columns，再 exec `platform setup`。

## 11. 下一 Chat 的推荐执行顺序

```text
1. 读取本文件 + README + 09 + 10 + 05 + 11
2. git diff / git status，确认 WIP 边界
3. CodeGraph 重新验证 P1 调用链与 blast radius
4. 对照正式 Role/Custom GPT/Deployment spec 与 Test Plan
5. 冻结最小修复设计
```
```text
6. 先补失败回归测试，再改实现
7. affected package tests/typecheck/gate
8. 不发布前先解决当前 SAME SCENE orphan authority
9. 安全恢复 test-ops Role，证明没有重复创建
10. SAME SCENE: setup/status/start/backstage
11. 版本 bump + release plan + 真实 npm publish
12. Product Workspace 只升级 affected packages
13. 最后一遍 FULL FRESH 普通用户模拟
14. 没有真实 blocker 就直接 DEPLOYMENT_SUCCESS=YES，结束 Deployment
```

发布属于非幂等操作：timeout/UNKNOWN 时先 Registry exact/latest readback，禁止盲目重复 publish。

## 12. 最终验收只需要证明这些

```text
真实 Registry latest
Fresh Workspace
platform install 23/23
initial status 不假 READY
platform setup 一路完成
Browser READY
Tunnel READY
Model FAST / THINK READY
3 Role exactly READY
platform start 成功
final platform status = PLATFORM_READY=YES
repeat setup/status 安全
stop → start → status 安全
runtime/backend truth 与 CLI 一致
```

若只有不影响上述标准的 formatter、文案细枝末节或外部一次性网络波动，不要继续扩大问题范围。
## 13. 可直接复制给下一 Chat 的提示词

```text
接管 ProFlow Phase 3 Deployment 最终收口。

仓库：/Users/agent/Desktop/proton-workspace/repos/proflow
Product Workspace：/Users/agent/Desktop/proton-workspace

第一步先完整读取：
1. spec/平台架构与公共约定/00-公共上下文/12-Deployment最终人工验证阻断与新Chat交接-20260901.md
2. 同目录 README.md
3. 09-Real3当前上下文与未解决问题-20260829.md
4. 10-Deployment-Closeout循环测试进度计划书.md
5. 05-执行纪律与工具规则.md
6. 11-跨项目自动化模拟人工测试提效方法论.md

当前唯一目标：修复最终 Fresh 人工模拟发现的 P1，然后安全 SAME SCENE 恢复，最后 Fresh 一次，满足标准后直接判 DEPLOYMENT_SUCCESS=YES 并结束 Deployment。

P1：第三个 agent-test-ops Custom GPT 在远端已经创建后，Carrier live validation 瞬时失败；createCustomGptRole 回滚了本地 Role，但不会删除不可逆的远端 GPT。当前本地只有 2 个 Role，因此直接重跑 platform setup 存在重复创建第三个 GPT 的风险。

禁止直接重跑 platform setup，先恢复 remote/local authority。
```
```text
用户冻结：Custom GPT / 智能提示创建浏览器操作不要动。不要改 selectors、点击顺序、等待、create-only、并发/串行、reuse/skip 语义。Browser Extension install/uninstall 也只使用仓库 canonical human-e2e helper，不写临时第二套脚本。

当前 packages/agent-runtime/src/role-management-client.ts 有未完成、未测试 WIP：RoleCarrierValidationEvidenceInput / hasCurrentRoleCarrierValidationEvidence / recordRoleCarrierValidationEvidence。第一件事先 git diff 审它，不得当成完成代码。

工作方法：CodeGraph 先确认结构和 blast radius，再读当前磁盘源码/精确搜索交叉验证；先失败测试，再实现；只跑 affected Gate；阶段末一次全仓 Gate。非幂等 publish/create timeout 时先 authority readback，禁止盲重试。

推荐修复原则：LIVE_CREATED 后本地 Role authority 不可因瞬时 live probe 被遗忘；Carrier validation 独立可重试；重入只 retry validation、不再 create；validation evidence 不含 secret，且 role/package/carrier/gateway drift 时自动 stale。最终设计以正式 spec/Test Plan 为准。

修复后先 SAME SCENE 证明：当前第三 Role 可安全恢复且没有重复 GPT；随后 start/status/backstage。再做 affected package 版本/release，真实 npm Registry exact/latest readback，Product Workspace 只升级 affected packages。

最后只跑一遍 FULL FRESH 普通用户 Journey：Fresh → Registry latest → install → status → setup → Browser/Tunnel/Model/3 Role → start/status → repeat setup/status → stop/start/status → backstage reality。不要为了找问题而找问题；若没有真正 blocker，直接裁决 DEPLOYMENT_SUCCESS=YES 并结束 Deployment。

不要 push，除非用户明确要求。
```

## 14. 当前裁决

```text
DEPLOYMENT_CORE_3_OF_3 = YES
ROLE_READY = 2/3
PLATFORM_READY = NO
DEPLOYMENT_SUCCESS = NO
唯一阻断 = P1 irreversible Custom GPT create + post-create live validation rollback/retry safety
```

## 15. 交接文件落盘时的 Git 现场

交接文件已真实写入仓库目录；尝试只提交 README + 本文件时，本机 Git commit 进程两次无输出卡住，因此已主动终止，**没有继续盲重试**。

权威读回：

```text
HEAD = a80547eeed203f58701fcebaea46166da59569f1
.git/index.lock = 不存在
```

因此下一 Chat 第一轮 Git 检查必须确认：

```text
git status --short
git diff
git diff --cached
```

README / 本 handoff 可能已 staged；`packages/agent-runtime/src/role-management-client.ts` 的 WIP 不应被误提交。先恢复 Git authority，再继续修 P1。
