# ProFlow Context Isolation

## 1. 正式边界

```text
proton-workspace/
├── repos/
│   ├── proflow/               # 当前正式产品
│   └── ai-agent-platform/     # legacy/reference-only
└── .proflow/                  # ProFlow workspace instance
```

## 2. ProFlow 开发时的默认上下文

默认允许：

- `repos/proflow/**`
- `proton-workspace` 根级 Workspace 规则中与 ProFlow 编排直接有关的内容
- 已落库的 FINAL FROZEN Phase 3 Spec / Test Plan

默认禁止把以下内容作为输入：

- `repos/ai-agent-platform/AGENTS.md`
- `repos/ai-agent-platform/package.json`
- `repos/ai-agent-platform/packages/**`
- `repos/ai-agent-platform/docs/**`
- 旧仓库的目录组织、包结构、脚本命名和运行目录语义

## 3. Legacy 唯一允许用途

只有当前任务明确写出：

```text
LEGACY_REFERENCE_ALLOWED
```

才允许读取 `../ai-agent-platform/**`。

允许查阅的目的仅限：

- 历史实验结果
- 已验证的失败模式
- Browser / Gateway / Runtime 的真实工程经验
- 性能或稳定性历史证据
- 可复用但必须重新适配 ProFlow Contract 的实现技巧

禁止：

- 直接复制旧架构
- 以旧代码推翻 Frozen Spec
- 建立 npm/workspace/relative/link 依赖
- 修改旧仓库
- 让旧 AGENTS 或旧目录成为 ProFlow 规则

## 4. 真源顺序

```text
1. FINAL FROZEN DDD/SDD
2. FINAL FROZEN Test Plan
3. 已通过当前 TDD Gate 的 ProFlow 代码
4. 明确授权后的 legacy evidence
```

发生冲突时，高优先级真源覆盖低优先级来源。
