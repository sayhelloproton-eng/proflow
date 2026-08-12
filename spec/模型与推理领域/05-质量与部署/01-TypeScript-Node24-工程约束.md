---
docId: MODEL-DOC-05-01
title: 14 · TypeScript / Node 24.19.0 工程约束
docType: engineering-constraints
authority: normative
lifecycle: active
domain: model-reasoning
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 14 · TypeScript / Node 24.19.0 工程约束

## 1. [FROZEN] TypeScript-first

以下必须 TS 强类型：

- Public Contract；
- Reasoning Spec；
- Spec input/output；
- Capability Proposal；
- Inference Result/Error；
- RuntimeStatus；
- Provider normalized result；
- 内部模块接口。

## 2. [CURRENT] Node 基线

```text
Node.js 24.19.0
TypeScript 7.0.2
pnpm 11.21.0
ESM only
tsc --noEmit
```

开发/CLI/脚本优先直接运行可擦除 TypeScript：

```bash
node src/main.ts
pnpm exec tsc --noEmit
```

默认不引入 `tsx` / `ts-node`。

## 3. [FROZEN] runtime validation

TS 不能保护 HTTP/JSON/provider 边界。

统一规则：

```ts
const raw: unknown = await readBoundary();
const value = schema.parse(raw);
```

不得：

```ts
const value = raw as SomeDto;
```

## 4. [FROZEN] `any`

公共合同与边界处理禁止 `any`。

需要未知输入时使用 `unknown`。

## 5. [RECOMMENDED] Spec registry

v1 可以代码静态 export：

```ts
export const reasoningSpecs = {
  "execution.command-risk.v1": commandRiskV1,
  "browser.page-state.v1": browserPageStateV1,
} as const;
```

不需要数据库或运行时注册服务。

## 6. [RECOMMENDED] Provider config 只用 typed config

Deployment 生成或读取的 provider config 也必须 runtime validate；配置槽位、materialization 和 conformance 由 Deployment Domain 的正式 Contract 定义。
