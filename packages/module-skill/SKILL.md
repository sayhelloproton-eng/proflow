# module-skill

AI 开发辅助 Skill。使用既有 Contract / Template / Conformance 创建与维护 ProFlow Module。不自创新规范，不成为第二业务 Runtime。部署与生命周期由 Platform CLI 治理。

## Source Order

修改或创建任何 Module 前，按顺序读取：

1. 目标 Domain / Module 的 `README.md` → `TECHNICAL-DESIGN.md` → `TODO.md` 与所属领域正式 Contract。
2. `module-contract`：Module 形式与治理规则真源。
3. `module-template`：统一 scaffold / profile 与稳定 create CLI。
4. `deployment-conformance`：强制门 C1 / C2 / C3。
5. 目标 Module 自身 Public Contract / API / deployment design。

## Required Owner Facts For Create

创建新 Module 前必须从正式设计得到，缺失则 STOP：

- `moduleRef`
- `packageName`（正式包必须是 `@tomflow/proflow-*`）
- `kind`
- `installClass`：`core | optional`
- `domain`
- `summary`

以下内容也必须由 Owner 文档提供或在生成骨架后由 Owner 明确填写，不能由 Skill 猜测：

- `provides` / `requires`
- requirements / config slots
- commands / APIs / permissions
- lifecycle / verification
- effects / cleanup retention
- package-owned docs

## Create Flow

1. 读取 Required Owner Facts。
2. 调用唯一标准 Template CLI，不手工复制 package scaffold：

```text
npx @tomflow/proflow-module-template create \
  --target <packages-directory> \
  --module-ref <moduleRef> \
  --package <@tomflow/proflow-...> \
  --kind <profile> \
  --install-class <core|optional> \
  --domain <domain> \
  --summary <summary>
```

3. 在生成骨架中填入目标 Module 的真实 Owner facts：Provides/Requires/API/config/lifecycle/effects/docs。
4. 运行 Deployment Conformance。
5. Conformance FAIL → STOP；不得通过修改规范或测试来绕过。

Template CLI 与 `materializeModule()` 必须是同一实现；Skill 不维护生成文件正文，不形成第二套模板。

## Modify Flow

1. 读取当前已安装/源码 Module 的 package metadata、Descriptor 与正式设计。
2. 只修改 Owner 允许范围内的事实与实现。
3. 保持 package metadata / Descriptor / Adapter / Docs 一致。
4. 运行 Deployment Conformance；FAIL 则停止。

## Forbidden

- 不得 invent `capability` / `dependency` / `permission` / `owner` / `domain` / `installClass` / `lifecycle` / `service` / `process`。
- 不得 hand-copy 另一 Module 作为正式 scaffold 入口。
- 不得 deep import 其他领域内部实现。
- 不得读写其他领域的 Store。
- 不得修改 Frozen Spec 或正式测试用例来让实现通过。

## Stop Rules

遇到以下任一情况，立即 STOP，不得猜测补全：

- 缺 Required Owner Facts；
- `PENDING_DECISION` / `NOT_FROZEN` / `ACCEPTANCE_NOT_FROZEN` / `SPEC_GAP` / `PENDING_SPIKE`；
- 缺失 dependency / permission / conformance 信息；
- Template / Contract / Conformance 之间出现正式冲突。

## Deployment Use

Platform CLI 负责 Registry/Workspace Discovery、install、preflight、plan、apply、lifecycle、verify、doctor、docs 与 uninstall。Skill 不自行发明 npm install 顺序、start script、migration 或 cleanup shell。

## Current Validation Policy

当前 Real-1 blocker 整改先进行人工真实创建/安装验证；正式自动化测试用例与 evidence 在人工通过后再更新。
