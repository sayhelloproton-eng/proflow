---
docId: DEPLOYMENT-DOC-03-04
title: Workspace 元数据、目录、Secret 与安全
docType: persistence-security
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# Workspace 元数据、目录、Secret 与安全

## 1. Workspace 模型

Workspace 根继续承载真实 package manifest/lockfile、用户源码和 `.proflow`：

```text
workspace/
├── package.json
├── <package-manager lockfile>
├── src/
├── docs/
└── .proflow/
```

`.proflow` 属于 Workspace / 用户数据，不等同于“当前已安装”。

## 2. `.proflow` 的保留语义

它可以包含：

```text
Workspace-local identity / binding metadata
Module config
runtime-local data / logs / cache
用户历史记录
凭据引用
```

因此 `platform uninstall` 永远不自动删除 `.proflow`。历史 `.proflow` 可以在 reinstall 时继续存在并被校验/复用。

旧 `.proflow/deployment/plans`、verification index、generated `INSTALL.md`、apply state 不再是当前 Platform CLI 必需状态。

## 3. Binding

Binding 只是 Workspace-local identity metadata，不再存在 global binding lifecycle、tombstone 或 `INSTALLING/UNINSTALLING/BROKEN` 状态机。

Install 只在成功同步 package + descriptor 后初始化/复用最小 metadata；metadata 与当前 Workspace 明显冲突时 fail-closed。

## 4. Config ownership

Module owns config/state semantics。Platform 只保存通用 Workspace identity/metadata，不读取、不解释 Module 私有 config，也不作为跨 Module config bus。

Module 能唯一确定的路径、端口、token、artifact/config 文件由 `Module.install` 自闭环；跨 Module 值通过 Producer-owned Contract/shared fact；真实用户选择或外部现实进入 `Module.setup`。

## 5. Secret

- raw secret 不进入 CLI JSON、日志、docs 聚合或通用 evidence；
- Module 只读取自己拥有的 credential/state contract；
- 受控文件需限制权限；
- Platform 不建立新的 Vault Service，也不复制领域 credential 语义。

## 6. 原子性

只为七命令所需的最小 Workspace-local metadata 使用安全原子写。旧 Plan/Apply persistence 与 exclusive apply lock 在零 caller 后删除。
