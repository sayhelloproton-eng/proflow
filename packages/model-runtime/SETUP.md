# model-runtime Setup

## STEP-MODEL-RUNTIME-01 — 自动验证 inventory 并映射 FAST / REASON

Responsible: AI
Interactive executable: `pnpm exec -- proflow-model-runtime setup`
Non-interactive executable: `pnpm exec -- proflow-model-runtime setup`
Required inputs: none
Verify: `pnpm exec -- proflow-model-runtime verify`
Success condition: FAST 与 REASON 都由真实能力证据映射并持久化。

模块读取 Provider 已验证的 inventory，逐个执行有界 text、structured output、reasoning 与 Vision 验证；候选之间默认冷却 5 秒。模型 ID 仅是 inventory identity，不能替代能力证据。正常路径不要求 `--fast-model` 或 `--reason-model`。

## STEP-MODEL-RUNTIME-02 — 仅在证据合格候选仍歧义时选择

Responsible: USER
Interactive executable: `pnpm exec -- proflow-model-runtime setup`
Non-interactive executable: `pnpm exec -- proflow-model-runtime setup --fast-model <verified-id>` 或 `--reason-model <verified-id>`
Required inputs: 仅 ACTION_REQUIRED 指出的单个歧义角色
Verify: `pnpm exec -- proflow-model-runtime verify`
Success condition: `model-runtime.setupStatus=READY`。

人工选择不能绕过能力验证。inventory、能力证据或证据时效发生变化时，旧映射先变为 stale，再重新验证；缺角色、服务离线或验证失败时不得假 READY。

## STEP-MODEL-RUNTIME-03 — 启动和观察本地服务

Responsible: AI
Interactive executable: `platform start`
Non-interactive executable: `platform start`
Required inputs: none
Verify: `platform status`
Success condition: `model-runtime.runtimeStatus=RUNNING` 且认证 `/ready` 返回就绪。

完成 setup 后由 Platform 生命周期按依赖顺序启动 Service。Platform 的七命令合同不提供定向 `start/stop --module`；运行态必须同时满足本地进程和上游 Provider 真实可用，`verify`、`status` 与 `/ready` 不把离线或依赖未就绪报告为 READY。
