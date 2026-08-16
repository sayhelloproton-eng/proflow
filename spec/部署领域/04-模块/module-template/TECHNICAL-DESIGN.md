---
docId: DEPLOYMENT-MODULE-TEMPLATE-TECH-DESIGN
title: '`module-template` 详细技术方案'
docType: module-design
authority: normative
lifecycle: active
domain: deployment-governance
moduleRef: module-template
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-MODULE-TEMPLATE-TECH-DESIGN
---

# `module-template` 详细技术方案

## 1. 定位

Template 是所有新 Module 的标准工程起点，也是已有 Module 的持续治理版本基线。

> Template 负责“默认形式正确”，Contract + Conformance 负责“持续必须正确”；领域具体职责、API、依赖与安全语义仍由 Module Owner 填写。

AI/开发者不得手工复制治理骨架作为新 Module 的标准创建方式。正式 Create Flow 必须通过 `module-skill` 指导并调用 `module-template` 的稳定 CLI/materialize API。

## 2. Module Kind Profile

v1 一个 Template Package 支持六种 Profile：

```text
library
service
cli
browser-extension
agent-package
external-resource
```

不维护六套彼此漂移的独立模板。

## 3. Create 输入事实

创建新 Module 时，以下事实必须显式来自目标领域/模块设计，不由 Template 猜测：

```text
targetDirectory
moduleRef
packageName (@tomflow/proflow-*)
kind
installClass (core | optional)
domain
summary
moduleVersion (可使用明确默认版本)
platformCompatibility (可使用明确模板默认范围)
```

`installClass/domain/summary` 不允许通过 package 名自动推断。

## 4. 稳定 CLI 创建入口

`module-template` package 必须提供可被 AI/人机械调用的 npm `bin`。第一版命令形态固定为：

```text
proflow-module-template create \
  --target <packages-directory> \
  --module-ref <moduleRef> \
  --package <@tomflow/proflow-...> \
  --kind <profile> \
  --install-class <core|optional> \
  --domain <domain> \
  --summary <text>
```

通过 `npx @tomflow/proflow-module-template create ...` 调用时必须走同一入口。

CLI 只把显式输入转为 `materializeModule()` 调用并输出 structured JSON result；不能形成第二套模板实现。

## 5. 共同生成内容

```text
package.json
README.md
src/
deployment/
  descriptor.ts
  requirements.ts
  verification.ts
  adapter.ts
conformance.json
```

只生成 Kind 真正需要的文件。

### `package.json`

除 npm 标准字段外，必须天然生成：

```json
{
  "proflow": {
    "module": true,
    "installClass": "core | optional",
    "descriptor": "./dist/deployment/descriptor.js"
  }
}
```

并保证发布 `dist`、`README.md`、`conformance.json`，让 Registry Discovery、Workspace Discovery 和 AI docs aggregation 有稳定入口。

### Descriptor

新包 Descriptor 必须天然包含：

- `installClass`；
- `identity.domain / identity.summary`；
- Provides / Requires 空骨架；
- requirements/config/lifecycle/verification；
- effects + cleanup retention；
- package-owned documentation entry。

Template 只提供合法骨架；Owner 必须把默认占位内容替换为真实领域事实后再通过 Conformance。

### library

无伪造 `start/stop/restart`。普通 npm package remove 不要求 library 虚构 package-owned uninstall lifecycle。

### service

增加 lifecycle adapter、status/start/stop/restart；通用 service process effect 默认为 package-owned `remove`。若 Service 有持久数据/文件，Owner 必须显式补充 effects/retention。

### cli

增加标准 structured JSON CLI entry。

### browser-extension

增加 extension build/package metadata、browser-specific status/verify adapter；外部 Chrome 实例/用户状态不得被模板假定可自动删除。

### agent-package

增加 Agent package deployment descriptor、GPT 创建/注册所需说明与 ACTION_REQUIRED integration；真实 carrier/remote state 不由模板自动 destructive cleanup。

### external-resource

增加 resource adapter、config/status/verify/doctor；Template 不假设远端资源可由 package uninstall 自动删除。

## 6. Template Version

每个 Module 记录 `templateVersion`。

Template 版本升级不会自动强迫所有 Module 当天迁移；只有出现：

- contract incompatibility；
- platform compatibility 不满足；
- mandatory security/engineering requirement；

才形成 migration requirement。

迁移后必须重新 Conformance。

## 7. TypeScript 工程基线

- TypeScript first；
- Node 24.19.0；
- Node.js 原生 TypeScript 运行；
- `tsc --noEmit` type gate；
- public boundary runtime validation；
- 禁止 `any` 漂移；
- structured JSON output。

## 8. 当前测试纪律

本轮先闭环模板形式、CLI 和人工真实创建/安装路径；现有正式测试用例/测试计划暂不改写。人工验证通过后再更新自动化用例与 evidence。

### Package-owned npx installation entry

Every generated ProFlow Module publishes one package-name-matching npm `bin` entry for `npx <package> install`. The entry points at a root `self-install.mjs` that is explicitly included in the npm `files` allowlist, so package-self installation does not depend on TypeScript build output. The generated executable is deliberately a thin delegator only: it invokes `@tomflow/proflow-platform-cli install <self-package>` against `process.cwd()`. It MUST support `--help/-h` without mutation so npm publishability/binary discovery can probe it safely. It MUST NOT reimplement Registry discovery, package-manager selection, package mutation, Deployment planning, lifecycle or verification. Therefore both Platform-initiated install and package-initiated npx install converge on the same Workspace `package.json` fact and the same Platform governance path.

### Registry bootstrap index

Every newly generated Module starts with `package.json.proflow.installRequires: []`. When the owner later declares package-level bootstrap dependencies, AI must fill exact ProFlow package names there instead of teaching Platform CLI a hard-coded catalog. Template owns the field shape; the Module owner owns the concrete package facts; Conformance rejects malformed/self/duplicate entries.
## Service process binding

The `service` profile MUST expose the standard `createServiceProcessBinding` seam. The generated skeleton remains fail-closed until the package owner supplies the real package-owned binary configuration and runtime probes. Platform CLI owns detached process supervision, PID/runtime-state persistence, stop/restart, and process logs; a generated service module must not implement cross-CLI lifecycle as an in-memory state variable.


### Static Manifest Generation

Template materialize 新 Module 时 MUST 同时生成根级 `proflow.module.json`，并在 `package.json.proflow.manifest` 与 npm `files` allowlist 中声明它。manifest 必须由与 runtime Descriptor 相同的输入事实生成，而不是让 AI 另外维护一份手写合同。

后续 owner 修改 Descriptor 事实时，必须同步更新 static manifest 并重新运行 Conformance；Template/Skill 不允许 AI 省略这一步。
