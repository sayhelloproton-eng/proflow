---
docId: TP-MODULE-PLATFORM-CLI
title: platform-cli｜开发前 Module Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
boundedContext: deployment-governance
moduleRef: platform-cli
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceRefs:
- DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN
- DEPLOYMENT-DOC-05-02
- DEPLOYMENT-DOC-05-03
- DEPLOYMENT-DOC-03-04
implementationWave: Wave 6
---

# platform-cli 测试计划

## Frozen surface

Platform 顶层公开命令为八个：

```text
install
update
uninstall
status
setup
docs
start
stop
```

其中 Module management contract 仍严格保持七命令 `install/uninstall/status/setup/docs/start/stop`。`update` 只属于 Workspace package maintenance：定向更新一个已安装 governed ProFlow package，随后复用既有 `Module.install` 完成该包工作区物化；禁止新增 `Module.update`。

`modules` 与所有 removed Platform commands 必须不可 routable；Module-specific extra command 不进入 Platform。

所有 ProFlow-owned CLI 均不提供 `--json`；`runCli()` 直接返回强类型对象，终端入口只渲染人类输出。传入 `--json` 必须返回 INVALID_REQUEST 并退出 1。

## Targeted tests

### status / setup / docs

`status` == Module.status 聚合并翻译公共枚举；`setup` == Module.setup 结构化 Step 聚合；`docs` == Module.docs 正文聚合且不显示 SETUP。Platform 不推导 private config/health，也不读取 configSlots 后生成 setup 指导。

### install / update / uninstall

Install 先完成 Registry/package-manager 的一次性 package-set sync，再校验 dependency graph，随后按冻结 Deployment Install Order 调用 Module.install；不得使用 Registry 返回顺序、packageName 字母序或 dependency depth 作为 install 产品顺序。Uninstall 仍先 reverse dependency-order Module.uninstall，再 package remove，只清理由本次 install 引入的 pnpm minimumReleaseAgeExclude，保留用户 policy 与 `.proflow`。

Update 必须使用 `--package <packageName>` 精确定位一个当前已安装的 governed ProFlow package；只做该包的定向 Registry lookup 和一次 package-manager mutation，保留所有 sibling dependency；版本落盘后重新读取 installed descriptor，并复用该 Module 的 `install` 完成工作区物化。运行中的 verified/unverified start owner 均必须 fail-closed，要求先 `platform stop`。

- [x] **CP-DEP-CLI-UPDATE-01** — `platform update --package` 只更新目标包到 Registry latest，不触发 scope search、不改 sibling dependency，并复用目标 Module.install。
- [x] **CP-DEP-CLI-UPDATE-02** — 缺少 `--package` 或目标不是当前已安装 governed ProFlow package 时，在 Registry/package-manager mutation 前失败。

### deployment install order

- [x] **CP-DEP-CLI-INSTALL-ORDER-01** — 冻结前序必须为 `chrome-runtime → execution-browser-extension → agent-controller-dev → agent-product → agent-test-ops → agent-gateway → dev-tunnel`。
- [x] **CP-DEP-CLI-INSTALL-ORDER-02** — 同一组 Module 无论 discovery/Registry 输入顺序如何，`Module.install` 调用序列保持一致。
- [x] **CP-DEP-CLI-INSTALL-ORDER-03** — Platform 在固定 install order 前仍运行 dependency graph 校验；unresolved/incompatible/cycle 不得因固定顺序被绕过。
- [x] **CP-DEP-CLI-INSTALL-ORDER-04** — 未进入冻结表的未来 Module 必须排在已知 Module 之后并按稳定 `moduleRef` 排序。
- [x] **RF-DEP-CLI-INSTALL-ORDER-01** — 把 `setup/start` 也切到 Deployment Install Order，破坏真实 Runtime dependency topology。
- [x] **RF-DEP-CLI-INSTALL-ORDER-02** — 继续把 npm/Registry 字母序或 graph depth 当作用户部署顺序。

### start / stop

Start 必须扫描全部 Module.status；任一 Module `setupStatus != READY` 时列全 blocker 且 0 次 start。全部 READY 后 dependency-order 执行，RUNNING/NOT_APPLICABLE 跳过，失败后 fail-fast；重试从失败点继续。Stop reverse-order，STOPPED/NOT_APPLICABLE 跳过，失败后 fail-fast，重试跳过已停止模块。

### composition

Platform 不存在 `createProductionBinding(configByModuleRef)`、private config loader、Module-specific branch。Internal service process entrypoint 可以存在，但 ownership 在 Module.start/stop。

## Simulated human integration

```text
Fresh Workspace
→ install
→ status
→ docs
→ setup
→ simulate ACTION_REQUIRED completion
→ setup
→ status
→ start
→ status
→ stop
→ uninstall
```

Final assertion：没有隐藏 old-engine route，Platform 不需要理解任何具体 Module 的 Chrome/GPT/Tunnel/SQLite/port/config 业务。

人工输出断言：长命令在完成前产生进度；帮助、状态、setup、start/stop 摘要均中文化；不得输出整块 JSON。

终端快照覆盖 TTY/非 TTY、`NO_COLOR`、80/120 列；已完成阶段不得被 spinner 擦除。Registry/package-manager 的事件必须在相应外部命令完成前可观察，Status/Start/Stop 必须提供分组、原因和可执行下一步。Docs 在 TTY/非 TTY 均连续输出全部文档且不启动分页器，Markdown 结构不得被简单剥离。Start status 预检保留逐 Module 结构化事件，但 TTY 只动态刷新当前计数，最终 blocker 只渲染一次。

Fresh Workspace 的初始状态必须真实 fail-closed，不得假 READY；当前 Final Fresh 观察为核心配置 `0/3`，随后通过公开 setup/recovery 达到 `3/3`。usage error 显示上下文帮助，运行期错误不追加整页帮助；Uninstall 成功文案统一为“已经卸载”。

## Setup 全量聚合新增证明

- 证明 `platform setup` 一次遍历全部 discovered Module，READY 跳过。
- 证明首个 `ACTION_REQUIRED` 或 `FAILED` 不终止后续 Module setup。
- 证明最终一次性聚合所有未 READY Module 的 action/error/data。
- 证明 Platform 不解释 package-owned Step、executable/verify 或 opaque input。


## 2026-08-23 Real-2｜Setup Dependency Readiness Addendum

- [x] **CP-DEP-CLI-REAL2-01** — `platform setup` 仍全量扫描，但在调用某 Module.setup 前 generic 检查其 required providers 的本次真实 `setupStatus`；provider 非 READY 时 dependent 标记 `BLOCKED` 且 setup 调用次数为 0。
- [x] **CP-DEP-CLI-REAL2-02** — provider 的 Module.setup 返回后必须重新观察 provider `Module.status`；若同一次调用中已 READY，则排序在后的 dependent 可以继续 setup，无需用户再启动第二个 Platform workflow。
- [x] **CP-DEP-CLI-REAL2-03** — provider ACTION_REQUIRED/FAILED/BLOCKED 不终止全量扫描；其 downstream 被 generic BLOCKED，完全独立的 Module 仍继续 setup 并被聚合。
- [x] **CP-DEP-CLI-REAL2-04** — gating 只使用 dependency graph + 标准 Module.status，不出现 `execution-browser-extension`、Agent Package、GPT、Chrome 等 module-specific branch，也不持久化 dependency setup state。
- [x] **CP-DEP-CLI-REAL2-05** — `custom-gpt-web-provisioning` provider READY 前三个 Agent Package setup 均不会被调用；READY 后由同一 generic graph 自动解除阻塞。

- [x] **RF-DEP-CLI-REAL2-01** — 仅排序但不 gate，导致 provider 未 READY 时 dependent setup 抢跑。
- [x] **RF-DEP-CLI-REAL2-02** — 用 setup command 返回 `SUCCEEDED` 直接猜 provider READY，而不重新读取 Module.status。
- [x] **RF-DEP-CLI-REAL2-03** — 为 Real-2 增加 moduleRef-specific if/else、config bus、持久化 resume state 或新的 Platform 顶层命令。

上述 proof 属 Platform generic orchestration；Custom GPT 页面本身仍由 owning Agent Package + Browser Extension 专项计划验收。

## 2026-09-01 Final Freeze lifecycle proofs

- [x] **CP-DEP-CLI-FINAL-01** — setup 为 Agent capability 校验临时启动 dependency 时，同时支持 `service` 与 `external-resource` owner；对应 `packages/platform-cli/tests/lifecycle.test.ts` 的 external-resource regression。
- [x] **CP-DEP-CLI-FINAL-02** — 成功 `platform start` 必须把 runtime lifecycle 转交给 detached start owner；前台 CLI 在收到 owner 启动确认后退出并归还 shell，随后独立 `platform stop` 通过 owner SIGTERM 完成公共 stop lifecycle；对应 `packages/platform-cli/tests/cross-process-stop.test.ts`。
- [x] **CP-DEP-CLI-FINAL-03** — 正式 recovery contract 为串行 shell 可执行的 `start → status → stop → start → status`；每次 `start` 都必须在 detached owner 确认后自行返回，重复 start 不得创建第二个 owner。
- [x] **CP-DEP-CLI-FINAL-04** — repeat `platform setup` / `status` 必须安全重入；Final Fresh 真实 evidence 最终 `PLATFORM_READY=YES`。
