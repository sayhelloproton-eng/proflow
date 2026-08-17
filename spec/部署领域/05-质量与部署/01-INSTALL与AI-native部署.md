---
docId: DEPLOYMENT-DOC-05-01
title: INSTALL 与 AI-native Deployment
docType: operational-design
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# INSTALL 与 AI-native Deployment

## 1. Global CLI、Single Workspace Binding 与安装事实

第一版 `platform` 是 Shell 全局命令；Global CLI binary 的安装生命周期与 ProFlow Platform Instance / Workspace 的安装生命周期彼此独立。`platform uninstall` 卸载的是当前唯一绑定的 Platform Instance，并解除 Workspace binding；它不等价于删除全局安装的 `@tomflow/proflow-platform-cli` package。

第一版全局同时只允许 `0 or 1` 个受管 Workspace。Platform CLI 必须维护 durable global binding，并把当前 `boundWorkspace` 作为用户可观察的一等部署事实。

安装目标解析固定为：

```text
platform install
→ requestedWorkspace = process.cwd()

platform install --workspace <path>
→ requestedWorkspace = explicit path
```

`--workspace` 第一版必须支持，主要服务 Agent / 自动化调用；它只负责确定 `requestedWorkspace`，不能绕过 single-binding。进入 binding 判断前必须 canonicalize（absolute + realpath/等价规范化），避免相对路径、`..` 或 symlink 把同一 Workspace 误判为不同实例。

若当前无 binding，可原子占用 requested Workspace 并进入安装；若已经绑定 Workspace A：同一 canonical Workspace 的重复 install 只允许幂等 `ALREADY_INSTALLED / no-op success`，不同 Workspace B 必须 `WORKSPACE_ALREADY_BOUND`，要求先 `platform uninstall` 再安装 B。不得静默覆盖、切换或同时管理第二个 Workspace。

`status/start/stop/restart/verify/doctor/modules/docs/upgrade/uninstall` 等当前实例命令不以 cwd 决定目标；它们必须读取 global binding，并在任意目录操作当前唯一 `boundWorkspace`。无 binding 时必须明确返回 `WORKSPACE_NOT_BOUND / NOT_INSTALLED`，不得从 cwd 猜测平台实例。`platform status` 必须直接暴露当前绑定目录。

安装完成的机器事实必须落在目标 Workspace：

```text
<workspace>/package.json
<workspace>/lockfile
<workspace>/node_modules
<workspace>/.proflow/
```

`.proflow` 只保存 Deployment/Runtime 配置、状态、日志、证据等平台运行事实，不能代替 npm package installation fact。

任何正式 ProFlow package，无论由 `platform install`、指定 package 安装，还是 package 自身 `npx ... install` 入口进入 Workspace，只要最终登记在 Workspace `package.json` 且本地可解析，就进入 Platform CLI 的统一管理集合。

安装入口允许两种等价形式：

- `platform install [package]`：Platform CLI 直接表达平台级安装意图；
- `npx <proflow-package> install`：package-owned 入口只识别“安装我自己”，随后委托 Shell-global `platform install <self-package> --workspace <cwd>`；不得 transient 下载另一份 Platform CLI。

两种入口必须汇聚到同一套 Global Binding → Registry Discovery → Planner → Apply → Workspace package manager 流程；package 自身不得复制第二套安装器，也不得通过 `npx @tomflow/proflow-platform-cli` 绕过全局 CLI 与唯一 Workspace Binding。已有同名业务 CLI 的 Module 复用其 `install` 子命令；没有业务 CLI 的 Module 使用 Module Template 统一生成的 `self-install.mjs`。

## 2. 两类发现，不维护固定安装目录

### Registry Discovery：识别“可以安装什么”

Platform CLI 不内置固定 Platform Install Catalog。

首次安装或搜索时，CLI 动态查询 npm Registry 中 ProFlow 私有 scope 下的 `@tomflow/proflow-*` candidate，读取 npm/package metadata，并按 Module Contract 验证：

- 正式 ProFlow Module marker；
- `core | optional` install class；
- package/version 是否被 npm deprecate；
- Node / Platform compatibility；
- package metadata 与 Descriptor 是否可被当前 CLI 理解。

`platform install` 默认选择当前 Registry 中有效的 `core` Module；显式指定 package 时允许安装合法 `optional` Module。

这里的动态发现严格限定 ProFlow npm scope，不建设通用 Marketplace、Plugin Registry Service 或全网任意 npm package 自动接入能力。

### Workspace Discovery：识别“当前管理什么”

Platform CLI 先读取 durable global binding，得到当前唯一 `boundWorkspace`，再读取该 Workspace `package.json` 的 dependencies/devDependencies，并对本地可解析 package 验证 ProFlow Module metadata/Descriptor，形成 Managed Module Set。

只有 `platform install` 在当前无 binding 时，才通过 cwd 或显式 `--workspace <path>` 确定新的 requested Workspace。实例建立后，当前 shell cwd 不再改变 Managed World。

Platform 的 start/stop/status/verify/doctor/upgrade/uninstall/docs 均以该唯一 bound Workspace 的 Managed Module Set 为当前 reality，不以安装入口来源或当前目录区分治理方式。

## 3. 安装前环境检查

真实 package install 之前必须检查：

- Node 是否存在且版本满足要求；
- 目标 Workspace 是否存在/可写，`package.json` 是否可读或可创建；
- global binding 是否允许本次 requested Workspace，且跨进程 global operation lock 未被其它实例 mutation 占用；
- Workspace package manager 的确定性事实；第一版正式支持 `npm | yarn | pnpm`，不能把 pnpm 当作用户前置要求；
- package manager executable 是否可用；
- npm Registry / ProFlow scope registry 是否可访问；
- 私有 scope 所需 registry auth 是否可用。

Workspace package manager 的选择优先读取 `package.json#packageManager`，并结合对应 lockfile / executable 做一致性校验；事实冲突或声明不受支持时必须返回 typed BLOCKED/ACTION_REQUIRED，不能猜。Global CLI 自身由 npm/yarn/pnpm 中哪一种工具安装，与 bound Workspace 选择哪一种 package manager 无关。

环境缺失必须返回稳定的 structured result / action-required，不得把空 `install()`、假 `installedVersion` 或源码 monorepo 存在误报为真实安装成功。

## 3.1 Global binding 原子性、状态与恢复

“只能安装一次”必须由跨进程原子机制保证，不能实现为普通的 `if (!binding) install()`。第一版至少需要：

```text
UNBOUND
INSTALLING
INSTALLED
UNINSTALLING
BROKEN
```

install 必须先获得 global operation lock，再通过短 binding lock 检查并原子 claim requested Workspace。安装中途失败时不得悄悄清除 binding 并允许另一个 Workspace 接管；必须保留可诊断的 `BROKEN` 事实，直到用户完成恢复或显式卸载/forget。`apply/start/stop/restart/upgrade/module-uninstall/whole-instance uninstall` 等实例 mutation 同样必须受 global operation lock 串行化。

Binding 至少持久化 canonical workspace path 与 stable workspace instance identity。若 bound Workspace 被手工移动/删除，`status/doctor/uninstall` 必须报告 `BOUND_WORKSPACE_MISSING`；普通 uninstall 不能假装已经清理不存在的 Workspace。允许显式 forget/force-forget 只清除失效 global binding，但必须明确说明它没有证明 Workspace 内部资源已被清理。

## 4. 两层 INSTALL 文档

### 静态 Bootstrap INSTALL

仓库/Deployment Package 可以有简短静态入口，告诉 AI/人：

- 如何获得/运行 Platform CLI；
- 工作区要求；
- 如何执行 environment preflight / install / plan；
- 安全边界。

### 实例级 Generated INSTALL

真正部署计划生成：

```text
.proflow/deployment/generated/INSTALL.md
```

内容必须由当前 Workspace 已安装 Module 的 package-owned Descriptor/Docs 与当前真实环境机械聚合，至少包括：

- Module Set / versions；
- machine/runtime；
- Provides / Requires；
- external resources；
- config slots；
- human actions；
- effects / cleanup policy；
- lifecycle support；
- verification/diagnostic plan。

Platform CLI 不手工维护每个业务 Module 的说明副本。

## 5. AI 主流程

```text
理解用户目标
→ 读取 platform modules/docs/status（当前能力与 reality）
→ 如需新增 Module：registry search / install
→ 调 environment/preflight
→ 调 platform plan
→ 解释结构化 plan
→ 请求集中确认
→ 调 platform apply
→ 遇 ACTION_REQUIRED 给用户最小人工操作
→ 再 apply
→ verify
→ manifest
→ 总结
```

当前阶段可以人工直接测试这些 CLI 行为；最终产品目标是让 AI 通过稳定、机器可读的 CLI 契约完成相同流程。

## 6. Small-model friendly

部署合同必须 structured JSON + stable enum/error code，AI 不需要从自然语言猜：

- 是否成功；
- 哪一步失败；
- 是否需要人；
- 是否可继续；
- 当前 Module/Version/Verify reality；
- 当前可安装/已安装 Module；
- Module Provides/Requires/Commands/APIs/Docs；
- lifecycle 是否支持。

## 7. 不允许 AI 旁路

在 Platform CLI 已提供能力时，AI 不应该自己发明：

- npm install 顺序；
- config files；
- service start scripts；
- external setup shell；
- module migration procedure；
- package cleanup/uninstall procedure。

如需要新增能力，应先通过 Module Contract/Template/Conformance 补齐，再由 CLI 执行。

## 8. Fresh Workspace dependency closure

Registry bootstrap is fail-closed. `platform install <package>` resolves the requested package by exact npm metadata and recursively follows `package.json.proflow.installRequires`; it does not rely on npm transitive installation to decide the Platform Managed Module Set. `platform install` without an explicit package discovers core packages and MUST fail when Registry discovery yields zero installable core candidates; an empty successful plan is forbidden. After package mutation completes, Workspace Discovery reloads the real installed Descriptors and normal Provides/Requires governance resumes.

### Package bootstrap closure


For single-package install, Registry bootstrap resolves `package.json.proflow.installRequires` recursively. The index is the union of ProFlow runtime npm dependencies and additional ProFlow packages required for direct Workspace governance. npm transitive installation alone is not enough: required ProFlow Modules must be planned as direct Workspace packages so Workspace Discovery can manage them uniformly.
