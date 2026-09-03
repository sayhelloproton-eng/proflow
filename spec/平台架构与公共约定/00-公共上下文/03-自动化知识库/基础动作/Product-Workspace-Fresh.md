# Primitive｜Product Workspace Fresh

> Fresh 是昂贵的“从零用户”测试动作，不是日常 repair loop 的默认动作。

## 什么时候允许用

- 明确验收从零 Deployment / install。
- 首次证明 `platform update` 前建立可信已安装基线。
- 有真实证据说明 Workspace 状态污染导致无法判定产品行为，并且当前验收目标本身要求 Fresh。

`platform update` 已真实 N→N+1 PASS 后，普通包修复禁止再 Fresh + 全量 install。

## 既有脚本

使用仓库已有 `pnpm fresh:workspace --workspace /Users/agent/Desktop/proton-workspace`，不要临时拼 `rm -rf`。

该脚本有安全护栏：要求绝对 workspace、拒绝 `/`/home/repo root、保护 `repos/`，正常会先尝试 platform stop，并清理 `.proflow`、`node_modules`、package manifest/locks、releases 等产品工作区状态。

## 操作边界

Fresh 清理本地状态不等于删除远端资源。不得为了 Fresh 自动删除 Microsoft Dev Tunnel、Custom GPT 等 durable external resources；对应包应按 stable identity/recovery Runbook 恢复。

Fresh 后安装必须来自真实 npm Registry；禁止先把 repo source / workspace link 注入 Product Workspace。
