# Primitive｜npm 发布与 Registry 回读

> 发布后的真实 npm 世界是测试系统的一部分。Repo source 不是终点，Registry 也不是终点，真实 Product Workspace 行为才是最终 Truth。

## 非幂等保护

发布前先确认：本地 candidate version、目标 package、当前 Registry exact/version 状态。若 exact 已存在，禁止重复 publish 同版本。

发布后必须 Registry exact readback；只有 Registry 明确存在目标版本，才进入 Product Workspace update/install。

网络 timeout / readback UNKNOWN **不等于 MISSING**。此时换可靠查询通道或稍后重读，禁止凭猜测再次 publish。

## 短阶段

```text
version facts → STOP
build/publishability → STOP
Registry exact preflight → STOP
publish → STOP
Registry exact readback → STOP
Product Workspace update → STOP
```

不要把版本、build、publish、Fresh、install、Journey 串成一个不可观察的长任务。

## Release 入口与 dirty tree 边界

正常整批发布优先使用仓库 canonical `pnpm package:release`，但**执行前必须先 `pnpm package:release --plan` / changeset release plan，确认本次 release set 与用户授权范围一致**。该脚本要求 clean working tree，并会消费当前 pending changeset plan、同步版本事实、提交 version commit 和发布 release set；仓库存在无关 dirty WIP / 无关 changeset 时，禁止为了修一个包直接运行它。

Real-3 等穿插式单包修复若仓库同时有无关 changeset/WIP，已验证的隔离路径是：

```text
Registry exact <target@next> 先确认 MISSING
→ 只 bump target package
→ node scripts/release-sync-versions.mjs --write <target>
→ node scripts/release-sync-versions.mjs --check <target>
→ target gate/build
→ 只 publish target package
→ Registry exact 目标版本
→ platform update --package <target>
→ 原用户 checkpoint
```

这是**隔离修复的恢复路径**，不替代正常 clean-tree changeset release。publish 命令 timeout/UNKNOWN 后仍先 Registry exact；已存在目标版本绝不重复 publish。

### Release Harness 卡死 / 命令形状失败

Release 前置工具失败先分类，不要直接升级成 package/release failure：

```text
包没有 build script
build-packages 参数形状错误
zsh 路径变量被当成一个参数
changeset status / release plan CLI 长时间不返回
```

这些默认属于 `HARNESS_FAILURE`。正确处理顺序：

1. 从根 `package.json` / canonical script 读取真实入口和参数，不凭记忆拼命令。
2. 若 `package:release --plan` / `change status` 之类 plan CLI 自己卡死，先读取 `.changeset/ledger.yaml` 与当前 changeset 文件，确认哪些 intent 已消费、哪些仍 pending；不要无限等待一个辅助 CLI。
3. 只有 release set 被 authority 证明与授权范围一致，才进入真正的非幂等 publish。
4. Build/publishability runner session 出现工具层“无退出回执”时，先查 OS process/产物/日志真值；没有对应进程不能直接宣告 build fail，更不能盲启动第二次昂贵 gate。
5. Harness 修正后复用已经证明过的产品测试结果；若源码未变，不为了修命令形状重复跑与其无关的全量测试。

固定原则：**release ceremony 可以 fail closed，但不能把辅助命令自身的不可靠性伪装成产品 defect。**

## tarball 边界

正常 Fast Loop 不使用 local tarball 代替 Registry 安装。`pack/.tgz` 只在 publishability 异常、files 配置或“源码修了但包里可能没有”时做诊断性内容检查；最终验收仍必须 publish → Registry → Workspace。
