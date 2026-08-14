# module-skill

AI 开发辅助 Skill。用已冻结的 Contract / Template / Conformance 创建与维护 ProFlow Module。不自创新规范，不成为第二业务 Runtime。部署与生命周期由 platform-cli 治理。

## Source Order

修改任何 Module 前，按顺序读取：

1. 目标 Module 的 `README.md` → `TECHNICAL-DESIGN.md` → `TODO.md` → 所属领域 Test Plan。
2. `module-contract`（规则真源：descriptor schema）。
3. `module-template`（工程模板与治理基线）。
4. `deployment-conformance`（强制门 C1 / C2 / C3）。
5. 目标 Module 所属领域的 Public Contract / descriptor。

## Allowed Facts

只消费以下已冻结事实，不得自行补全：

- `moduleRef` / `packageName` / `moduleVersion` / `kind`
- `provides` / `requires`
- `requirements` / `configSlots`
- `lifecycle` / `verification` / `effects`
- `Frozen TODO` / `Frozen Test Plan` / `Frozen Contract`

## Forbidden

- 不得 invent `capability` / `dependency` / `permission` / `owner` / `domain` / `lifecycle` / `service` / `process`。
- 不得 deep import 其他领域内部实现。
- 不得读写其他领域的 Store。
- 不得修改 Frozen Spec 让测试通过。

## Stop Rules

遇到以下任一情况，立即 STOP / NOT_FROZEN，不得猜测补全：

- `PENDING_DECISION`
- `NOT_FROZEN`
- `ACCEPTANCE_NOT_FROZEN`
- `SPEC_GAP`
- `PENDING_SPIKE`
- 缺失 `dependency` / `permission` / `conformance` 信息

## Create/Modify Flow

1. 读取 frozen facts（见 Source Order / Allowed Facts）。
2. 用 module-template 生成或采用最小结构。
3. 实现最小 owner 行为（不扩展 Frozen Spec）。
4. 运行 C1 / C2 / C3（deployment-conformance）。
5. 产物 Conformance FAIL → STOP，不继续。

## Deployment Use

platform-cli 负责 preflight → plan → explain → apply → ACTION_REQUIRED → same plan resume → verify → manifest。本 Skill 不自行发明 install / start / migrate shell。
