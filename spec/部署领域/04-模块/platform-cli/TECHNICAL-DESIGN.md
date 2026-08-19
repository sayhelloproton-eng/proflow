---
docId: DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN
title: '`platform-cli` 详细技术方案'
docType: module-design
authority: normative
lifecycle: active
domain: deployment-governance
moduleRef: platform-cli
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN
- DEPLOYMENT-DOC-02-01
---

# `platform-cli` 详细技术方案

## 1. 定位

Platform CLI 是 Deployment Domain 唯一平台级确定性应用，也是第一版 Shell 全局 `platform` Deployment Control Plane。

它不懂其他领域内部业务，只懂 Module Contract 和公开 lifecycle/verification contract。Global CLI binary 与 Platform Instance 生命周期分离；第一版同时只允许一个 durable global Workspace binding。

## 2. Commands

```bash
platform search [package]
platform modules [module]
platform preflight [module]
platform preflight --intent install
platform install [package] [--workspace <path>]
platform uninstall [module|package]
platform upgrade [module]
platform plan --intent install|configure|upgrade|uninstall|repair [options]
platform apply <planRef>
platform start [module]
platform stop [module]
platform status [module]
platform verify [module]
platform doctor [module]
platform manifest [module]
```

命令分为三层：

- `search` 读取 npm Registry reality，回答“当前可以安装什么”；
- `modules/status/...` 读取 Workspace reality，回答“当前已经安装并由平台管理什么”；
- `install/uninstall/upgrade` 是用户/AI 级意图入口，必须复用 Deployment Planner/Apply 与 package manager driver，不建立第二套旁路安装器；
- `install` 在无 binding 时用 cwd 或 `--workspace` 建立唯一 Workspace binding；其余实例命令从 global binding 解析目标，不跟随当前 cwd。

`restart` 可通过 stop/start 组合或未来 alias，不增加独立部署语义。

## 3. `preflight`

`preflight` 有两类只读检查，不能混淆：

### Installer environment preflight

`platform preflight --intent install` 在 Fresh Workspace 尚无任何 ProFlow Module 时也必须可执行，检查：

- 当前 Node runtime 与最低版本；
- npm CLI；
- Workspace 路径/写权限；
- `package.json` 是否可读或可创建；
- Workspace 已声明 package manager 时，对应 executable 是否可用；
- 未声明 package manager 时允许使用 npm 作为 bootstrap package manager；
- ProFlow scope registry 可访问性与认证可用性。

它只判断“安装器能否开始工作”，不得先要求 Module config。

### Managed Module preflight

普通 `platform preflight [module]` 汇总：

- Module Descriptor validity；
- current environment；
- Requires/Provides；
- Config availability；
- External Resource status；
- Human prerequisites；
- compatibility。

两类 preflight 都只检查，不执行有副作用部署。


## 4. Registry Discovery 与 Workspace Discovery

### Registry Discovery

Platform CLI 通过 npm CLI/Registry 配置读取 `@tomflow` scope 对应 registry，查询 `@tomflow/proflow-*` candidate，再读取 package metadata。只有同时满足以下条件才进入可安装集合：

- package name 属于 `@tomflow/proflow-*`；
- `package.json.proflow.module === true`；
- `proflow.installClass` 是当前合同支持的值；
- package/version 未被 npm deprecate；
- Node `engines` 与当前 runtime 兼容。

Registry auth 由 npm 自身配置（用户/Workspace `.npmrc` 等）承载；Platform CLI 不复制 token，也不自己建立第二份 registry credential store。

### Workspace Discovery

第一版先从 global binding store 解析唯一 `boundWorkspace`，再从该 Workspace 根 `package.json` 的 `dependencies/devDependencies` 枚举已安装候选，通过本地 package resolution + ProFlow metadata + Descriptor/Adapter 验证形成 Managed Module Set。

只有首次 `platform install` 在 global binding 为 UNBOUND 时使用 cwd / `--workspace` 选择 requested Workspace；绑定后，切换 shell 目录不会切换 Managed World。

“是否受平台管理”只由 bound Workspace 的真实安装事实决定，与最初通过 `platform install`、package-owned install 或其他合法安装入口无关。


## 5. Fresh install / package mutation

Fresh Workspace 的 Registry package 在安装前尚不能本地 import 完整 Descriptor，因此 install 必须分清两种事实：

1. Registry package metadata 决定 packageName/version/installClass 与是否允许安装；
2. package mutation 完成后，Workspace Discovery 再从本地已安装版本读取完整 Descriptor/Adapter，进入后续 config/lifecycle/verify。

`plan --intent install` 对 Registry candidate 生成受控 package bootstrap steps，只冻结精确 package/version，不伪造尚未安装的 Provides/Requires/lifecycle。Apply 必须使用目标 Workspace 的真实 package manager：

- 第一版正式支持 `npm | yarn | pnpm`；
- 优先读取 `package.json#packageManager`，结合对应 lockfile 与 executable 做确定性一致性检查；
- Workspace 未声明 package manager 时可以按冻结 fallback 规则选择 bootstrap manager，但不得默认要求 pnpm；
- 声明、lockfile 与 executable 事实冲突时 `BLOCKED/ACTION_REQUIRED`，不能猜；
- 声明的 package manager 不可用时 `ACTION_REQUIRED`；
- package manager command 以 argv 调用，不经过任意 shell；
- package install 默认禁止 package lifecycle scripts 旁路 Deployment adapter；
- 成功后必须能从 Workspace `package.json`、对应 lockfile 与本地 package resolution 观察到真实安装。

高层 `platform install` 复用 `plan -> apply`，package bootstrap 完成后立即重新 Workspace Discovery；后续缺 config/human/external reality 时返回结构化下一步，而不是把“包已安装”等同于“平台 READY”。

Package-owned `npx <package> install` 不是第二套安装实现。每个 Module 的稳定 package executable 只负责把自身 package name 委托给已经安装在 Shell PATH 中的全局 `platform install <self-package> --workspace <cwd>`：已有同名业务 CLI 时增加 `install` 分支；否则使用 Module Template 生成并随包发布的 `self-install.mjs`。package-owned 入口不得 transient `npx @tomflow/proflow-platform-cli` 下载另一份 CLI；若全局 `platform` 不存在，必须以 `GLOBAL_PLATFORM_CLI_REQUIRED` fail-closed。因此环境检查、Registry selection、Single Workspace Binding、Plan fingerprint、package mutation、Workspace rediscovery 和错误语义始终只有全局 Platform CLI 一份实现。

## 5.1 Global binding / cross-directory command semantics

第一版 global binding state 至少区分 `UNBOUND | INSTALLING | INSTALLED | UNINSTALLING | BROKEN`。所有改变唯一 Platform Instance 现实的命令必须受同一个 cross-process global operation lock 串行化；其中首次 `platform install/apply` 在锁内 canonicalize requested Workspace、检查 existing binding、原子 claim，再进入真实 package mutation。`start/stop/restart/upgrade/module-uninstall/whole-instance uninstall` 也不得与其它实例 mutation 并发。

```text
platform install
→ requestedWorkspace = cwd

platform install --workspace <path>
→ requestedWorkspace = explicit path (Agent-friendly)
```

若已绑定 A：再次请求 canonical A 为幂等 no-op；请求 B 必须返回 `WORKSPACE_ALREADY_BOUND`。`--workspace` 不得绕过该规则。

`platform status/start/stop/restart/modules/docs/verify/doctor/upgrade/uninstall` 在任意 cwd 都操作 A。`status` 的 machine/human output 必须暴露 `boundWorkspace`。无 binding 时实例命令返回 `WORKSPACE_NOT_BOUND/NOT_INSTALLED`。

Global binding 必须保存 canonical path + stable instance identity。若路径失效，报告 `BOUND_WORKSPACE_MISSING`，不得自动把 cwd 认成新 Workspace。

## 6. Uninstall

`uninstall` 是正式 Deployment intent。当前阶段规则：

- `core` Module 禁止单包 uninstall，返回 `CORE_PACKAGE_REQUIRED`；
- optional Module 卸载前先检查其他当前 Managed Module 是否依赖其 Provides；
- 支持 `uninstall` lifecycle 的 Module 先执行 package-owned cleanup；Service 在该 primitive 中负责 stop 本包服务并清理 `retention=remove` 的 owner effects；
- `preserve` 数据默认保留，`explicit-purge` 不由普通 uninstall 自动删除；
- cleanup 成功后再执行 package manager remove，并以 package 不再存在于 Workspace manifest/local resolution 作为 postcondition。

无 module/package 参数的 `platform uninstall` 是第一版 Platform Instance 卸载入口：无论当前 cwd 在哪里，都针对 global `boundWorkspace`，按受控顺序卸载实例、观察 postcondition，并仅在真实卸载闭环后解除 binding。它不卸载全局 CLI package 本身。

## 7. `plan`

输入目标 Module Set / target versions / instance config intention。

输出：

- resolved modules；
- dependency graph；
- config materialization；
- package/external changes；
- lifecycle steps；
- potential effects；
- human actions；
- verification steps；
- plan fingerprint。

Plan 不 apply。

## 8. `apply`

必须：

- exclusive workspace lock；
- 读取不可变 plan；
- 校验 plan 仍适用于当前 reality；
- 每步先 check；
- satisfied → SKIP；
- executable → EXECUTE；
- human → ACTION_REQUIRED + STOP；
- failure → FAILED + STOP；
- 原子更新 state/index；
- 完整结构化日志。

## 9. `start/stop`

`platform start` 与 `platform restart` 在进入 lifecycle dispatch 前必须复用 Managed Module preflight；preflight 非 `READY` 时直接返回对应 Findings，不进入任何 start/restart dispatch。

Platform 级 `restart` 定义为 `stop → start`：先按依赖逆拓扑执行 stop，全部成功后再按正拓扑执行 start；顶层不直接依赖各模块自有的 `restart` primitive。

只对支持对应 start/stop primitive 的 Deployment Unit 生效。全平台 start/stop/restart 按依赖拓扑顺序执行。

不要求 library/remote API 实现 start/stop。

## 10. `status`

实时调用 Module status，持久状态仅作为辅助。结果必须能区分 stale persisted fact 与 current reality。

## 11. `verify`

调用各领域公开 verify，写入 Version Verification Record；平台级 verify 再验证 Required Graph 是否整体满足。

## 12. `doctor`

诊断 + evidence + recommendation；不自动 repair。

需要修复时：

```text
platform doctor
→ platform plan --intent repair
→ confirm
→ platform apply
```

## 13. `docs`

`platform docs` 是面向 AI/人类的只读聚合入口，不维护 Module 业务知识副本。数据来源只允许来自当前 Workspace 真实安装的 package：

- Descriptor `identity`：所属 Domain 与职责摘要；
- package.json `bin`：该包真实发布的 CLI commands / executables；
- package.json `exports`：该包真实发布的 Public API entry points；
- Descriptor `provides/requires`：平台逻辑 Contract / API 依赖；
- Descriptor `lifecycle/configSlots/requirements/effects/verification`：运维与治理能力；
- Descriptor `documentation`：package-owned 文档索引与正文读取入口。

固定读取层级：

```text
platform docs
→ 当前 Managed Module 的轻量能力索引，不展开全部文档正文

platform docs <moduleRef|packageName>
→ 单 Module 完整结构化自描述 + 文档索引

platform docs <moduleRef|packageName> <documentId>
→ 读取该 Module Descriptor 声明的单份 package-owned 文档正文
```

文档路径必须经过 Descriptor/Conformance 约束并限制在 package root 内；CLI 不允许用户传任意文件路径。Workspace 未安装的 Registry candidate 不属于 `platform docs` 当前能力事实，应使用 `platform search`。

## 14. `manifest`

动态组合：

- root package.json / lockfile；
- Module Descriptors；
- Deployment state/history；
- live Module status；
- Verification Records；
- Provides/Requires resolution；
- unresolved ACTION_REQUIRED。

Manifest 不是人工维护真源。

---

## 当前正式约束：plan/apply 与状态真实性

Platform CLI 是唯一全局 Deployment Planner/Executor；Module 只声明 requirements/config/provides/requires/lifecycle/verification/effects。`status/verify/doctor` 必须读取当前 reality；doctor 默认只诊断，修改环境必须生成 repair plan。CLI 按需运行，不成为第二 Runtime/长期 workflow engine。
## Real-1 runtime diagnosis truthfulness

`platform doctor` MUST aggregate the module's live `status`, `verify`, and `doctor` results when those lifecycle primitives are declared. The effective diagnosis uses the most severe current result (`FAILED > BLOCKED > ACTION_REQUIRED > SUCCEEDED`). A package-owned `doctor()` result MUST NOT hide a failure already observed by `status` or `verify`; doctor remains read-only and only recommends the next action.
## Managed service process identity

Formal `service` modules use `createServiceProcessBinding` and are supervised by Platform CLI across CLI invocations. Missing service binding/config MUST remain unbound and MUST NOT fall back to legacy in-memory lifecycle composition. Runtime state is stored under Workspace `.proflow/runtime/services/<moduleRef>/`; before status/stop treats a PID as owned, Platform CLI validates that the live command line still references the recorded package-owned binary and generated runtime config, preventing stale PID reuse from targeting an unrelated process.


### Service process version reality

Platform Supervisor 的 durable process record 必须同时绑定 `moduleRef + packageName + moduleVersion + PID + binPath + configPath`。`status` 不能只判断 PID 存活：若当前 Workspace 已安装版本与 record 中运行版本不同，必须返回 `ACTION_REQUIRED/restart-service`，禁止把旧版本进程误报为新版本 RUNNING。`stop` 仍可停止同一 package/moduleRef 的旧版本进程，以便 upgrade plan 执行 restart。Supervisor 自己负责创建 `.proflow/runtime/services/*` 与 Deployment log 目录，因此通过外部合法 npm 安装进入 Workspace 的 Module 也可以第一次直接进入 Platform lifecycle。
