---
docId: DEPLOYMENT-DOC-03-01
title: 六命令编排流与失败边界
docType: runtime-flow
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 六命令编排流与失败边界

> 旧 Plan / Apply / Resume 产品流程已退休。本文给出当前薄 Platform CLI 的运行流。

## 1. 总原则

```text
用户意图 = 六个 CLI 命令
内部 primitive = 实现细节，不进入用户心智
```

Platform 不再生成 `planRef/stepRef/applyRef/resumeRef`，也不维护部署事务状态机。

## 2. Install

```text
Resolve Workspace
→ 校验已有 Workspace-local metadata
→ Registry 动态获得完整 ProFlow package/version set
→ 一次 package-manager transaction 同步
→ 重新读取真实安装结果
→ 校验 Module descriptors
→ Fresh 时初始化最小 .proflow metadata
```

失败即失败；不建立成功 Binding，不进入 Plan/Apply recovery。

## 3. Modules / Docs

`modules` 只读聚合当前 Module-owned status observation；`docs` 只读聚合 Module-owned knowledge。两者都不修复、不材料化配置、不执行人工动作。

## 4. Start

```text
Discover
→ Build runtime dependency order
→ Validate all applicable Modules (fail-fast)
→ only if all PASS: Start in dependency order (fail-fast)
```

Validate 阶段失败时，本轮不得启动任何 Module。

Start 阶段中途失败时：后续 Module 不再启动；已成功启动者保持真实现状；Platform 不自动 rollback/retry/repair。

Module 返回 `ACTION_REQUIRED` 等结构化信息时可原样透传，Platform 不建立 resumable workflow。

## 5. Stop

```text
Discover
→ Build runtime dependency order
→ Reverse order
→ Module stop (fail-fast)
```

Stop 不做 validate，也不隐式执行其它命令。

## 6. Uninstall

```text
识别 Workspace package.json 中 ProFlow dependencies/devDependencies
→ package manager 一次 remove transaction
→ 保留 .proflow
```

Uninstall 不自动 stop，不执行 cleanup workflow，不删除 Workspace 用户数据。

## 7. 并发与安全

Package manager 自己负责 package mutation 的锁文件/manifest 一致性。Platform 只保留实现六命令所需的最小 Workspace-local 原子 metadata 写入，不保留旧 apply lock/plan state。

## 8. Human / Web 操作

需要登录、浏览器加载、Custom GPT 配置、凭据等动作时，知识和检查归 owning Module。AI 通过 `platform docs` 获取操作说明；真正启动前由 Module validate/preflight 再确认。

不存在 `platform configure/repair/doctor/apply` 作为替代入口。
