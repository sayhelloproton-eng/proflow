# Runbook｜Platform CLI

> 用户唯一平台入口。稳定能力默认冻结，只有真实 regression 才局部修复。

## 公共命令

Platform 当前 8 个顶层命令：

```text
install  update  uninstall  status
setup    docs    start      stop
```

Module Contract 仍是 7 个标准生命周期命令；`platform update` 是 Platform Workspace/package maintenance，不新增 `Module.update`。

## install

`platform install` 已通过 Deployment Fresh 真实验收。日常 Real-3 repair loop 不再 Fresh + install；只有明确验证“从零安装”或 install regression 时才重开。

安装必须来自真实 npm Registry，不得用 repo source、link、local tarball 替代用户安装物。

## update

公开形式：`platform update --package <installed-proflow-package>`。

固定语义：Registry exact lookup 目标包 → 只更新该 package → 验证 installed version → 调用该目标现有 `Module.install` 重物化。其它包版本不应变化。

真实 N→N+1 基线已通过 Registry + Workspace + 目标 `Module.install` 证明，`PLATFORM_UPDATE_STABLE=YES`。具体历史版本只留 CURRENT/历史；后续 package repair 使用 update，不再重复全量 install。

运行中 owner 为 `RUNNING` 或 `UNVERIFIED` 时 update 必须 fail closed，避免运行中替换包。

## start / stop

产品裁决：`platform start` 成功后必须归还 shell，用户应能在同一终端自然执行 status / 业务操作 / stop。

当前实现由 foreground start 启动 detached start-owner；owner 持有真实 runtime handles。独立 `platform stop` 向 owner 发信号，由 owner 执行正常 in-process stop 并清理 owner record。

重复 start：已运行则明确返回“平台已在运行”，不得再启动第二套 runtime；owner 存活但无法验证时 fail closed。

## status / setup / docs

- `status` 只读，不应制造资源或修复状态。
- `setup` 可以按产品互动收集不可约人类动作，并沿现有 checkpoint 恢复；不能把内部 Module 概念暴露成用户正常步骤。
- `docs` 默认提供发现入口，详细内容用 `platform docs --module <moduleRef>`。

## 自动化注意

交互式 `platform setup` 的 CLI/PTTY、Browser OAuth、timeout/UNKNOWN 与恢复 mechanics 直接服从 `/Users/agent/Desktop/proton-workspace/skills/chat-local-acceptance-automation-protocol/SKILL.md`。`scripts/human-e2e/platform-setup.exp` 仍是 ProFlow 的 canonical setup harness 资产，但其调用/恢复方法不在本 Runbook 复制第二套协议。

CLI 全量 status/setup 需要构建完整 installed context，可能比单包动作慢。是否等待、如何保存进程证据和恢复由共享 Skill 决定；本 Runbook 只要求不得通过内部状态绕过公开 CLI 产品路径。
