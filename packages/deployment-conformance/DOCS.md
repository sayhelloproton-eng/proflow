# deployment-conformance — 模块一致性检查

## 模块定位与作用

机械验证 ProFlow Module 的 descriptor、package、adapter、DOCS/SETUP 和副作用声明，阻止不符合治理合同的包进入发布链。

## 主要能力

- C1 检查静态 Module Contract 与依赖拓扑。
- C2 检查 npm 包形态、公开 exports、文档和生成来源。
- C3 运行 adapter，验证结果身份、状态、非健康诊断和真实副作用边界。

## 提供的 API 与 Public Contract

- 不提供跨 Module 逻辑 Contract。
- 提供 `proflow-conformance` CLI 和可编程 conformance API。

## 依赖的 Module、Contract 和外部资源

- 无上游 Module Contract 依赖。
- 读取待检查包的公开 descriptor、adapter、package metadata 与标准文档。

## 运行形态与生命周期

类型为 CLI，检查完成后退出；没有独立进程。

## 使用方式

在测试、pack 和 publish 前运行 Conformance；任何 FAIL 都必须由 owning Module 修复。

## 职责边界与限制

只验证可机械判断的形式和边界，不证明业务逻辑正确，也不替 Platform 修复 Module。

## 术语

- Conformance（一致性）：实现与公开治理合同相符合。
- Gate（门禁）：不通过就禁止进入下一发布阶段的检查。
