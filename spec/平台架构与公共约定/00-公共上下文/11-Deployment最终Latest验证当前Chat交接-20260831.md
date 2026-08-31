# Deployment 最终 npm latest 验证｜当前 Chat 交接

> 日期：2026-08-31
> 仓库：`/Users/agent/Desktop/proton-workspace/repos/proflow`
> 真实 Product Workspace：`/Users/agent/Desktop/proton-workspace`
> 用途：下一主 Chat 直接续接 Deployment 最终 latest 验证与后续统一优化。

## 1. 用户当前最高目标

当前不是重开 Real-3/4/5/6，也不是继续泛化开发。

唯一目标仍是：

```text
真实 npm latest
→ 真实 Product Workspace
→ install / setup / start / status
→ Browser / Tunnel / Model / 3 GPT 外部现实
→ 最终部署主链真实跑通
→ Deployment PASS
→ 再统一处理本轮收集的 UX / 自动化优化项
→ 发布优化版本后再做一次 latest smoke
```

用户最新裁决：**只要最终主部署链真实跑通，即可认为部署成功；过程中发现但不阻断主链的问题归入优化，部署验证完成后再统一处理。**
## 2. 本 Chat 对“部署成功”的最终定义

部署成功不等于代码绿、不等于 `platform start` exit 0，也不等于历史 evidence 存在。

当前口径：

```text
Registry / npm latest 真实安装物
+ Fresh/真实 Workspace 安装
+ Browser / Tunnel / Model / 3 GPT 真实外部状态
+ start 后真实 runtime
+ status 与现实一致，不 Fake READY
+ 可恢复、可重复、不漂移
+ 用户心智足够低、自动化尽可能高
+ CLI 默认输出明确、舒服、只暴露用户决策所需信息
= Deployment Success
```

边界仍然是：

```text
DEPLOYMENT_SUCCESS != SYSTEM_REAL_USABLE
```

Deployment PASS 后才进入全局业务 Journey 验证；当前不要反向把 Real-3/4/5/6 业务能力塞回 Deployment Gate。
## 3. 本 Chat 已完成的重要技术闭环

### 3.1 platform-cli 0.1.47：运行中 uninstall lifecycle

真实 Product Workspace 发现旧行为：

```text
platform uninstall exit 0
但 foreground platform start owner 仍活着
5 个真实监听端口仍存在
```

Root：uninstall 没有在 package removal 前协调 foreground start owner。

修复遵守既有 pre-mutation 合同：

```text
package-manager preflight
→ requestStartOwnerStop
→ ABSENT / STOPPED 才继续
→ Module uninstall
→ package removal
```

`UNVERIFIED / TIMEOUT` fail-closed；package-manager conflict 仍保证任何 mutation 前失败。
结果：

```text
platform-cli package tests = 83/83 PASS
全仓 tests = 644/644 PASS
Architecture = PASS
Publishability = PASS
platform-cli@0.1.47 已发布
```

关键提交：

```text
b5b1bc6 fix(platform): stop runtime owner before uninstall
```

真实运行中 uninstall 最终重放：先停止 owner，再 23/23 uninstall；owner/5 端口/Dev Tunnel host 均退出；durable `.proflow` identities 保留。

### 3.2 Browser 0.1.20：运行中 bridge revalidation

此前已修复 setup 在 runtime bridge 已占 47080 时再次开 pairing server 导致 `EADDRINUSE` 的问题。

0.1.20 增加 authenticated `/v1/session/status`，允许 setup 通过当前运行 bridge 读取真实 live session 并刷新 evidence。
关键提交：

```text
372e073 fix(browser): revalidate running extension bridge during setup
```

真实 Product 验证曾证明：47080 保持被 runtime owner 占用时，stale evidence 可由 `platform setup` 直接 revalidate，不再 `EADDRINUSE`。

### 3.3 本 Chat 最新 Browser 正确性问题：Chrome restart 后 Fake READY

在用户新增的“真实 npm latest + 真实工作区”最终验证中，发现：

```text
platform status = 3/3 + PLATFORM_READY=YES
但 authenticated bridge /v1/session/status = online=false
```

受控重启 Chrome 后：

```text
bridge online=true
产生新的 extensionInstanceId
旧 verification evidence 仍指向旧 instance
旧 0.1.20 status/setup 仍把 Browser 当 READY / skip
```

这不是 UX 优化，而是 Deployment 正确性 blocker，因此先修复后才能继续最终 latest 验证。
修复设计不改 Frozen Contract：

```text
bridge 不存在（平台停机）
→ Browser setup evidence 可保持 READY
→ runtimeStatus 仍为 NOT_APPLICABLE

bridge 存在 + online=false
→ Browser 必须 fail-closed / ACTION_REQUIRED

bridge online=true + live instance != evidence instance
→ ACTION_REQUIRED
→ nextCommand = platform setup
→ 复用 0.1.20 running-bridge revalidation 刷新 evidence

bridge online=true + instance 一致
→ Browser READY
```

新 regression test 已先 RED 后 GREEN；targeted live-status test PASS，相关 Browser targeted tests 7/7 PASS，typecheck PASS。

真实 Product Workspace 用 source adapter 已正确识别：

```text
EXTENSION_SESSION_REVALIDATION_REQUIRED
```

说明修复与真实故障 seam 一致。
## 4. 当前权威机械快照（2026-08-31 本 Chat 最后恢复）

### Source repo

```text
HEAD = 57de2ad
commit = fix(browser): fail closed on stale live extension session
working tree = CLEAN
Browser source version = 0.1.21
```

### npm Registry

```text
@tomflow/proflow-execution-browser-extension latest = 0.1.21
Registry exact 0.1.21 = EXISTS
```

**禁止再次 publish 0.1.21。**

### Product Workspace

```text
platform-cli = 0.1.47
execution-browser-extension = 0.1.21
package.json = YES
package-lock.json = YES
pnpm-lock.yaml = NO
platform bin = YES
```

Product Workspace 仍是 npm-owned；禁止用 `pnpm exec platform`。
### 当前 runtime 物理状态

交接前最后一次机械检查：

```text
41705 DOWN
47080 DOWN
51443 DOWN
55225 DOWN
56107 DOWN
```

即：**当前平台是停机态**。不要把历史运行中的 5 services 当当前事实。

Browser durable evidence 当前：

```text
moduleVersion = 0.1.21
extensionId = eehdadpmjffomabiedcjijiakconalab
verification evidence 已刷新为 0.1.21
```

最后一次 evidence 中的 `extensionInstanceId` 已更新；下一 Chat 不应手工修改 evidence，应通过真实 bridge/status/setup 验证当前 Chrome instance。

3 个 Final-Fresh GPT role identity 仍完整存在：

```text
agent-controller-dev → g-6a945ff805a88191a2bec1f458c18ad2
agent-product        → g-6a94602671d48191b1008206196ef273
agent-test-ops       → g-6a94604bc4b08191a15c088c4e58d516
```

不要删除或无意义重建这 3 个 GPT。
## 5. 用户新增的“真实 npm latest”最终验证已经证明过的部分

真实 Product Workspace 执行：

```text
npm install @tomflow/proflow-platform-cli@latest
→ up to date
→ platform-cli = 0.1.47

npm outdated --json
→ {}
→ exit 0
→ 当时 23 个直接 ProFlow 依赖均为 npm latest
```

随后真实：

```text
platform install
→ 23/23 PASS
→ exit 0
```

停机后的 `platform setup` 首次遇到 Dev Tunnel 只读查询超时；恢复 authority 后同一 Tunnel 未丢失、remote host 正常，最终 setup 重入收敛：

```text
3/3 core setup PASS
exit 0
```

因此 Dev Tunnel query timeout 当前按优化候选记录，不删除远端 Tunnel、不重建 identity。
## 6. 本 Chat 已收集、但按用户要求延后统一处理的优化问题

以下问题在主部署链能最终跑通时，不应反向把 Deployment 判 FAIL；先记录，待 latest Deployment 验证完成后统一优化。

### O1 install 默认输出过多

真实 `platform install` 默认展开：

```text
23 次 Registry 安装前核验
+ 23 次 Module install/init 输出
```

技术证据明确，但普通用户会感觉同一批模块被重复展示两遍。建议默认聚合，详细 traversal 下沉 `--verbose` / doctor。

### O2 setup 默认 23 个 Module skip 噪声

全部已就绪时仍输出大量：

```text
[01/23] ... 跳过
...
[23/23] ... 跳过
```

理想默认输出只展示 3 个核心用户步骤及 root prerequisite。

### O3 Dev Tunnel CLI query timeout / retry UX

真实测得：

```text
devtunnel port list --json
一次耗时约 32.49s
热路径约 20s
```

Platform 曾因 timeout 提前判失败，但稍后同一命令 exit 0；应评估 bounded retry / timeout / reconcile，减少用户重复执行 `platform setup`。
### O4 `status` 的“真实服务进程数”计数/措辞不可信

真实运行中曾稳定出现：

```text
platform status
→ 3/3
→ PLATFORM_READY=YES
→ “2 个真实服务进程运行中”
```

但物理 `lsof` 同一 platform owner 同时持有 5 个服务监听端口：

```text
41705
47080
51443
55225
56107
```

因此不是服务缺失，而是聚合计数/“进程”定义与用户理解不一致。应统一为可解释的 service count 或明确“2 个 OS 进程 / 5 个服务”。

### O5 CLI 成功/停止措辞仍可打磨

例如：

```text
✓ 平台运行进程已停止 · 已经卸载
```

语义不自然；应拆成“已停止运行中的 ProFlow”与最终“ProFlow 已卸载”。

### O6 产品级总原则

默认 CLI 只暴露：

```text
当前状态 + 一个 root cause + 下一步
```

内部 Module traversal、dependency graph、owner details 默认隐藏，失败定位或 verbose/doctor 再展开。
## 7. 本 Chat 已经真实通过的 recovery / fail-closed 场景

这些不是当前停机态实时状态，但属于本轮已取得的真实证据；除非新版本改动直接影响对应 seam，不要机械重做全部。

```text
repeat platform install = PASS
repeat platform setup = PASS
repeat platform start = PASS
platform stop → start = PASS
Browser disable → NOT READY = PASS
Browser reload / running-bridge revalidation = PASS（0.1.20）
Dev Tunnel owned host down → NOT READY → same Tunnel recovery = PASS
Model endpoint unreachable → start fail-closed → restore = PASS
partial install → setup/start fail-closed = PASS
npm/pnpm package-manager conflict → pre-mutation failure = PASS
running uninstall → owner/ports stop before package removal = PASS（0.1.47）
uninstall → reinstall → durable identity preservation = PASS
```

Browser 0.1.21 是对 Chrome restart / live instance drift 的新增防回归；下一 Chat 必须补完该版本的真实 replay，不能只引用上面 0.1.20 的历史 PASS。

## 8. 真实外部组件历史稳定 identity

Dev Tunnel：继续复用当前 owned remote Tunnel；**禁止为了测试删除远端 Tunnel**。

真实模型 endpoint：

```text
http://192.168.0.108:8080/v1
```

Model 域只认 URL / FAST / THINK(REASON)，不要重新引入设备/厂商发现语义。
## 9. 0.1.21 release 状态的特别说明

本 Chat 中途曾看到 Browser package full test 进程输出，但工具 session 后来被回收，不能拿那次 session 的缺失尾部当最终 test authority。

交接前重新恢复的更高权威事实是：

```text
Source HEAD 已提交 0.1.21 修复
working tree CLEAN
npm Registry exact 0.1.21 EXISTS
npm dist-tag latest = 0.1.21
Product Workspace 已安装 0.1.21
Browser durable evidence 已是 0.1.21
```

因此：

- 不要重复 publish 0.1.21；
- 不要因为历史 session 尾部缺失就重新造新版本；
- 下一步优先回真实 Product Journey，证明 0.1.21 external reality；
- 只有新的源码修改（例如后续优化批次）才需要新的 package/full release Gate。

## 10. 下一 Chat 的精确续接点

当前平台停机，正确第一步不是继续改源码，而是从真实 npm latest Product Journey 开始：

```text
1. npm / Registry readback：确认 platform-cli latest=0.1.47、Browser latest=0.1.21
2. Product Workspace npm-owned hygiene / npm outdated
3. ./node_modules/.bin/platform status（停机态真值）
4. platform setup（若 Tunnel query 慢，恢复 authority，不盲重试）
5. platform start
6. 物理确认 5 个 service listeners / owner
7. Browser authenticated /v1/session/status：online=true 且 live instance == verification evidence
8. platform status 必须不再 Browser Fake READY
9. Tunnel HTTPS / Model / 3 GPT carrier 当前 reality
10. repeat setup/start/status 最小幂等 smoke
```

主链全部跑通后，先裁决 Deployment PASS，再进入 O1～O6 的统一优化批次。
## 11. 优化批次执行规则

Deployment 主链通过前：**禁止为了 O1～O6 提前改代码。**

Deployment PASS 后：

```text
一次性冻结优化 issue list
→ CodeGraph 先做 blast radius
→ 批量最小修改
→ targeted tests
→ 一次统一 full gate
→ 必要版本 bump / publish
→ Registry exact readback
→ Product Workspace npm @latest
→ 最后一遍用户视角 smoke
```

优化版本一旦发布，最终 smoke 必须重新使用新的 npm latest；不能拿优化前 latest 的 Deployment PASS 替代发布后的 smoke。

## 12. 执行纪律 / 禁止事项

- Product Workspace npm-owned：只用 `./node_modules/.bin/platform`，禁止 `pnpm exec platform`。
- publish 超时/UNKNOWN：先 Registry readback，禁止盲重发。
- **Browser 0.1.21 已发布，禁止重复 publish。**
- 不删除远端 Dev Tunnel 来制造 Fresh。
- 不删除/重建现有 3 GPT 来做无意义重复验证。
- 不读取/打印 token、credential、secret 内容。
- Browser live truth 必须来自真实 Chrome + authenticated bridge，不伪造 Origin/heartbeat。
- CodeGraph 先做结构定位，再 Local Dev 读当前源码/验证；dirty tree 冲突时以磁盘源码为真。
- 长进程启动一次后低频 poll；无输出不等于失败。
- 已经成功过的 Chrome/macOS 原生 UI 操作优先复用 SOP，不重新猜固定坐标。
- 不 git push。
- 不修改 Frozen Contract / Owner / Architecture，除非用户明确授权。
## 13. 当前 Gate 表

```text
Registry platform-cli latest 0.1.47                  PASS
Registry Browser latest 0.1.21                       PASS
Product npm-owned / Browser 0.1.21                   PASS
Source 57de2ad clean                                  PASS
Browser 0.1.21 source targeted regression            PASS
Current platform runtime                              STOPPED
Latest 0.1.21 real start/status/browser-live replay  PENDING
Tunnel latest reality                                 PENDING in next run
Model latest reality                                  PENDING in next run
3 GPT carrier latest reality                          PENDING in next run
Deployment latest final verdict                       NOT_YET_RECONFIRMED
Optimization O1~O6                                    DEFERRED_UNTIL_DEPLOYMENT_PASS
```

## 14. 允许停止连续执行的条件

下一 Chat 应持续推进，不在自然阶段边界停工。

只允许因以下事实中断：

```text
DEPLOYMENT latest 主链已 PASS 并进入明确优化阶段边界
不可替代 OAuth / 2FA / CAPTCHA / secret / 外部授权
Frozen Contract / Owner / Architecture 必须变更
工具明确不可恢复失败
真实上下文硬极限，需要安全交接
```

除此之外：记录 Gate → 立即继续。