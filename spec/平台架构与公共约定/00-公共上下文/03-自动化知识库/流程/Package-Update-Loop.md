# Flow｜Package Update Fast Loop

> 用于任意当前流程中发现某个包的真实 bug 后，快速修复、发布、单包更新并回到原 checkpoint。

## 前提

已通过真实 npm Registry + Product Workspace + 目标 `Module.install` 证明 `platform update --package <target>` 的实际 N→N+1 路径，`PLATFORM_UPDATE_STABLE=YES`。具体历史版本属于 CURRENT/历史 evidence，不固化在本 Flow。

因此日常 repair loop 不再 Fresh + 全量 install。

## 主流程

```text
保存当前用户 Journey checkpoint
→ 定位 owning package
→ 基础动作/Targeted-Gate
→ version candidate
→ 基础动作/npm发布与Registry回读
→ platform update --package <target>
→ 验证只更新目标包 + Module.install/materialization
→ 重放最初失败的用户可见行为
→ PASS：回原用户 Journey checkpoint，继续下一步
→ FAIL：继续同 owning package 最小修复
```

Package Runbook 决定“怎么验证目标功能”；本流程不复制 Browser/Tunnel/Model 的内部 SOP。

## 恢复规则

- publish/Registry UNKNOWN → 先 exact readback，禁止盲 publish。
- update 前目标必须是 Workspace 已安装 ProFlow package；运行中 owner RUNNING/UNVERIFIED 时先按产品生命周期正常 stop，不强行更新。
- update 完成后以 Product Workspace package version +目标功能现实为准，不以 repo package.json 替代。
- 已稳定的 install/setup/其它包不因单包修复重测。

## Browser Extension 包的额外闭环

Browser Extension 的“更新成功”不是一个单点，而是一条必须逐层对齐的现实链：

```text
Registry exact version
→ Product Workspace node_modules version
→ .proflow/deployment materialized manifest/artifact version
→ Chrome 当前已加载 Extension version / ID
→ platform setup / heartbeat runtime evidence
→ 原失败 Browser SAME SCENE 行为
```

前一层 PASS 不能替代后一层。尤其是 `platform setup` 显示 Browser Extension 配置步骤完成，只能证明 pairing/setup 观察满足当前判据；**不能单独证明 Chrome 当前可见 loaded version 已切到目标版本**。Extension 更新后至少需要 fresh `chrome://extensions` 版本/ID截图，再用真实 action / Tasks / content behavior 证明新 runtime 正在执行。

若 Workspace 与 materialized loadDir 已是 N+1，而 fresh Chrome screenshot 仍是 N，则当前动作只属于 **Chrome runtime adoption**，不得重新 publish、不得重复 `platform update`。此时按 `Browser-UI自动化.md` 的 privileged 一次前台原子回合完成 Reload/Load，再回后台做 heartbeat 和 SAME SCENE readback。Extension ID + 名称只能证明目标 identity，不能自动证明 AX card boundary；任何 Reload/Remove locator 都必须先在当前 Chrome fresh reality 中验证其动作与目标身份的独立可见/几何关系。Remove 等 destructive action 还必须通过原生确认框做第二身份校验，失败立即 STOP。

## 当前实例不得固化在 Flow

具体 target package、repo candidate、Registry version、Product Workspace installed version、当前 blocker 与返回 checkpoint **只写 `02-当前接力/CURRENT.md`**。本 Flow 只保存稳定编排，禁止再把某一轮 `0.1.x → 0.1.y` 版本事实写进来，否则新 Chat 会把历史实例误当当前任务。
