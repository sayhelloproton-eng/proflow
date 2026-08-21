# model-runtime Setup

## STEP-MODEL-RUNTIME-01 — 选择 FAST 与 REASON 模型
Responsible: USER
Interactive executable: `pnpm exec -- proflow-model-runtime setup 01`
Non-interactive executable: `pnpm exec -- proflow-model-runtime setup 01 --fast-model <id> --reason-model <id>`
Required inputs: FAST 模型 ID、REASON 模型 ID
Verify: `pnpm exec -- proflow-model-runtime verify`
Success condition: FAST 与 REASON 模型已保存并通过验证。

## STEP-MODEL-RUNTIME-02 — 验证模型角色
Responsible: AI
Interactive executable: `pnpm exec -- proflow-model-runtime setup 02`
Non-interactive executable: `pnpm exec -- proflow-model-runtime verify`
Required inputs: none
Verify: `pnpm exec -- proflow-model-runtime verify`
Success condition: `model-runtime.setupStatus=READY`.
