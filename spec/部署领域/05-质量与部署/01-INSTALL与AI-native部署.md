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

## 1. Workspace 与安装事实

Platform CLI 默认以当前执行目录 `process.cwd()` 作为目标 Workspace；`--workspace <path>` 仅作为显式覆盖能力。

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
- `npx <proflow-package> install`：package-owned 入口只识别“安装我自己”，随后委托 `@tomflow/proflow-platform-cli install <self-package>`。

两种入口必须汇聚到同一套 Registry Discovery → Planner → Apply → Workspace package manager 流程；package 自身不得复制第二套安装器。已有同名业务 CLI 的 Module 复用其 `install` 子命令；没有业务 CLI 的 Module 使用 Module Template 统一生成的 `self-install.mjs`。

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

Platform CLI 读取目标 Workspace `package.json` 的 dependencies/devDependencies，并对本地可解析 package 验证 ProFlow Module metadata/Descriptor，形成 Managed Module Set。

Platform 的 start/stop/status/verify/doctor/upgrade/uninstall/docs 均以该 Managed Module Set 为当前 reality，不以安装入口来源区分治理方式。

## 3. 安装前环境检查

真实 package install 之前必须检查：

- Node 是否存在且版本满足要求；
- npm 是否可用；
- 目标 Workspace 是否存在/可写，`package.json` 是否可读或可创建；
- package manager 是否可用；用户机器不能被假设已预装 pnpm；
- npm Registry 是否可访问；
- 私有 scope 所需 registry auth 是否可用。

环境缺失必须返回稳定的 structured result / action-required，不得把空 `install()`、假 `installedVersion` 或源码 monorepo 存在误报为真实安装成功。

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
