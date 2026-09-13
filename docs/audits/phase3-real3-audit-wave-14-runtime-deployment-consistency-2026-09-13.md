# Phase 3 Real-3 Audit｜Wave 14｜Runtime / Deployment Consistency

## Verdict

`CURRENT_INSTALLED_RUNTIME=PASS`。当前 workspace 的已安装发布基线已恢复到正式 READY；`CURRENT_SOURCE_TO_RUNTIME_PARITY=PENDING`，因为 Wave 10～13 的源码修复尚未进入 package version / release / install / runtime adoption。本 Wave 不把“运行态健康”误写成“当前审计源码已部署”。

## Mechanical authority

- source package version、workspace declaration、`pnpm-lock.yaml` resolution、`node_modules` installed version 对当前发布基线一致：Extension `0.1.62`、Platform Host `0.1.29`、Agent Gateway `0.1.18`、Execution Runtime `0.1.19`、Dev Tunnel `0.1.36`、Product `0.1.18`、Controller/Dev `0.1.21`、Test/Ops `0.1.21`。
- 初始 `platform status` 为 `2/3 / PLATFORM_READY=NO`，唯一 first divergence 是 Chrome Extension 重启后 verification evidence 失效。
- 正式 `platform setup` 只执行一次；启动记录出现 shell 作用域异常后先按 UNKNOWN reconciliation，保存的 setup log 证明该唯一实例已完成 `3/3`，未启动第二份。
- setup 后正式 `platform status` 为 `3/3 / PLATFORM_READY=YES`。
- Dev Tunnel package-owned `verify` PASS。
- Product / Controller-Dev / Test-Ops package-owned `verify --workspace` 三条全部 PASS。

## Browser Extension runtime

当前 materialized loadDir 的 Manifest：

```text
name = ProFlow Execution Browser
version = 0.1.62
manifest_version = 3
```

当前 verification evidence：

```text
contract = proflow.browser-extension-verification.v1
moduleVersion = 0.1.62
serviceWorker = RUNNING
evidenceSource = PAIRING_HEARTBEAT
extensionId = current shared-facts extensionId
loadDir = current shared-facts loadDir
observedAt = fresh post-setup observation
```

因此 Extension restart 后的 stale verification 已由正式 setup + fresh pairing heartbeat 收敛，不再是当前 blocker。

## Role / Host reality

- Product / Dev / Test durable Role identity 与 installed package version 一致。
- live Platform owner 仍由 workspace 正式 `platform start --workspace ...` 进程拥有；Role owner validation 返回当前 Role/version PASS。
- package-owned `verify` 使用 Module status + secret-free carrier validation evidence，是当前 READY authority。
- `role validate` 在没有 live material observation 时返回 `ROLE_CARRIER_MATERIAL_UNVERIFIED` 是当前明确的 fail-closed diagnostic contract；现有 subprocess regression 也要求该行为。它不能被误用为 Module READY 的替代 truth，也不能为了本 Wave 被过滤成假 PASS。

## Source → runtime adoption boundary

当前 repo working tree 已包含 Wave 10～13 的未发布源码变化，涉及至少：

```text
agent-gateway
execution-browser-extension
platform-host
task-orchestration
```

以及部分 Agent / Platform CLI regression-only tests。workspace `node_modules` 与当前 live runtime 仍是已发布 baseline，因此版本号相同不能证明当前 source bytes 已被采用。

这不是本 Wave 允许隐藏的 drift：

```text
source/tests PASS
!= package released
!= workspace installed
!= runtime adopted
```

后续处理归属：

1. Wave 15 Package Governance：核对 changed package ownership、changeset/version/release/install contract，避免源码语义变化停留在旧版本号。
2. Final runtime adoption：发布后按正式 install/setup/start/status 路径采用，不用手改 `node_modules` 或 materialized runtime。
3. Wave 21 Final Gate：再次证明 installed version / materialized runtime / Chrome runtime / Host/Gateway/Task owner 与最终 source release 一致。

## Wave result

```text
WAVE_14_CURRENT_RUNTIME=PASS
PLATFORM_READY=YES
EXTENSION_RUNTIME=0.1.62 READY
DEV_TUNNEL=PASS
ROLE_PACKAGE_VERIFY=3/3 PASS
SOURCE_RUNTIME_ADOPTION=PENDING_WAVE_15_AND_FINAL_GATE
```

本 Wave 不执行 package publish/release/install，也不把旧发布 baseline 的运行成功冒充最终 Phase 3 GO。
