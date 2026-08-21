# @tomflow/proflow-model-runtime — Module Setup

## STEP-MODEL-RUNTIME-01 — 选择 FAST 与 REASON 模型

Responsible: USER
Interactive executable: `pnpm exec -- proflow-model-runtime setup`
Non-interactive executable: `pnpm exec -- proflow-model-runtime setup --fast-model <id> --reason-model <id>`
Required inputs: FAST 模型 ID、REASON 模型 ID
Verify: `pnpm exec -- proflow-model-runtime verify`
Success condition: `model-runtime.setupStatus=READY`.
