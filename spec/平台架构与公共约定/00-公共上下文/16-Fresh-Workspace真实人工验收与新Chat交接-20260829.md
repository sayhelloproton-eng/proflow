# Fresh Workspace 真实人工验收与新 Chat 交接｜2026-08-29

> 这是 2026-08-29 起的**最新执行入口**。下一 Chat / Work 先读本文，再按需回读 `05 / 14 / 15`。
> **第 10 节保留本轮人工验收原始 P1～P18 问题登记表，编号、现象、当前判断、已确认根因/证据均不得省略；第 11 节才是合并后的整改 Root 分组。新执行者禁止只看 Root 分组而丢失原始问题。**
> 本文记录当前 Chat 已形成的阶段状态、真实 Registry/Fresh Workspace 事实、人工验收结果、已确认根因、保留现场与授权边界。
> 易漂移事实（HEAD、Git status、runtime 文件、远端 Tunnel）接管时必须机械重读，不能把本文快照当实时真值。

## 1. 当前一句话状态

```text
ARCHITECTURE = FROZEN
REAL_1 = PASS
REAL_2 = PASS / FROZEN
READY_FOR_REAL_3 = YES
CURRENT_STAGE = REAL_3
PHASE3_FINAL_GO = NO
```

Real-3 前置真实部署/Onboarding 人工验收已经暴露出一组明确 P0/P1 residual。当前**停止随机继续测试**，保留现场，等待下一 Chat 恢复权威状态后形成冻结整改计划并由用户授权。

固定路线不变：

```text
Real-1 Deployment / Registry / Fresh Workspace
→ Real-2 Real Custom GPT / Worker Identity
→ Real-3 J0~J4
→ Real-4 Collaboration + Approval + Effect
→ Real-5 Browser / File / FAST-REASON phone model
→ Real-6 Recovery + J0~J6
→ J0-J6 REAL PASS → PHASE3_FINAL_GO=YES
```

## 2. Registry、发布与 active surface

真实 npm Registry 发布已完成；本轮 14 个新版本最终 `14/14 PRESENT / 0 MISSING / 0 ERROR`。发布使用 `proflow-local-publish` 的 Bypass-2FA 能力；账号 WebAuthn/2FA 保留，token secret 不进入 Chat/文档/Git。

人工确认：

```text
platform -v = 0.1.38
active module count = 23
chatgpt-carrier = RETIRED / 非 active surface
releases/ = 已删除，不作为真实 Registry evidence
```

人工验收涉及的关键已发布版本：

```text
platform-cli                0.1.38
execution-browser-extension 0.1.14
chrome-runtime              0.1.15
dev-tunnel                  0.1.16
model-provider-api          0.1.13
model-runtime               0.1.16
agent-gateway               0.1.14
platform-host               0.1.14
```

Active surface 固定为 23 个模块；Carrier 不得重新进入 registry/order/governance。具体 23 项见 `15` 与当前 Registry/install readback；接管时机械复核版本而不是依赖本文静态列表。

本轮发布/人工验收相关关键提交链：

```text
eaae824 fix(platform): close setup status and retire carrier
4bd9b3d release: version real3 browser status closeout
29865b0 docs: define real registry publish workflow
7ad0ae1 docs: record real registry publication
5fb6b1e docs: record fresh workspace acceptance residuals
b8c961e docs: record browser setup acceptance findings
```

本文开始更新前 source repo 为 `main@b8c961e` 且 clean；本文提交后 HEAD 会前进，下一 Chat 必须机械读取最终 HEAD，不能以 `b8c961e` 作为当前 HEAD。

## 3. Fresh Workspace 真实安装事实

用户在 `/Users/agent/Desktop/proton-workspace` 做真实人工安装。测试前明确清除 `.proflow/`、`node_modules/`、安装 manifest/lockfile 与 `releases/`，保留 `repos/`、Git、README、AGENTS 等非安装资产。

真实 `platform install`：

```text
Registry candidate check = 23/23
ProFlow direct deps       = 23
install                   = SUCCEEDED
bootstrap package manager = npm
```

Fresh Workspace 当时没有 `packageManager` 声明，也没有 lockfile，因此当前实现按 `bootstrap-default = npm`，生成：

```text
package.json
package-lock.json
node_modules/
.proflow/
```

安装完成后已机械验证：`declared == installed == npm latest`，23/23 PASS。

已记录的 install residual：安装前逐包“核验 23/23”和安装后“已验证 23 个已安装模块”逻辑不同（前者 Registry candidate/descriptor，后者实际 dependency/version/descriptor），但用户文案过于相似，易被理解为重复。

## 4. Browser Extension 人工验收

真实 materialize 路径：

`/Users/agent/Desktop/proton-workspace/.proflow/deployment/browser-extension/execution-browser-extension`

macOS Chrome “加载已解压的扩展程序” chooser 默认看不到 `.proflow` 隐藏目录，用户普通点击无法选中；最终通过 `⌘⇧G` 输入完整路径后成功加载。Chrome Developer Mode 已开启。

真实结果：

```text
Extension version       = 0.1.14
pairing / hello         = PASS
heartbeat               = PASS
setupStatus             = READY
targeted rerun          = PASS / 快速 READY
```

已确认问题：

- `BROWSER_EXTENSION_HIDDEN_LOAD_DIR`：隐藏目录使普通新用户无法直接选择。
- `BROWSER_DEVELOPER_MODE_GUIDANCE`：虽有文字提示，但未做成明确 prerequisite gate/单焦点步骤。
- `TARGETED_SETUP_SUMMARY_SCOPE`：targeted setup 成功后输出“全部模块均已就绪。汇总：1 个已就绪”，实际只表示当前目标 module READY。
- `BROWSER_PRESTART_UNHANDLED_FETCH`：Extension 启动执行 `void runObserverRecovery()`；其中 `await invokeTaskApplication("task.list", {})` 在 `platform-host` 尚未启动的正常 pre-start 状态 reject，未被 catch，形成 Chrome 可见 `Uncaught (in promise) TypeError: Failed to fetch`。这不否定 pairing READY，但属于真实 runtime/UX bug。

## 5. Platform setup / status / docs 的人工心智问题

全量 `platform setup` 当前使用 dependency `graph.order`，不是面向新用户的人类 onboarding 顺序。`setupModulesThin()` 在非 targeted 模式下遇到 `ACTION_REQUIRED / FAILED` 只把 `completed=false`，仍继续遍历后续模块。

真实体验因此出现：

```text
Dev Tunnel GitHub browser auth
+ Browser Extension 人工加载
+ Model Provider setup plan
+ 后续状态汇总
```

多个流程交错，用户不知道“现在只需要完成哪一步”。正确产品心智应是：

```text
自动完成当前 root prerequisite 能自动做的部分
→ 到第一个不可约人类动作/失败
→ 只展示当前这一个步骤并 STOP
→ 人工完成后自动观察 READY
→ 再进入下一 prerequisite
```

其它已确认 UX：`platform docs` 一次输出 23 份完整 Module 文档，无 module filter/索引/当前状态导航，并暴露 package-level 命令和内部 Contract/Owner 术语；`platform status` 对 `agent-gateway` 会把已经存在 shared facts 的 `platform-host` 继续列为缺失，属于诊断过度报告。`platform start` 在存在 blockers 时 0 真实进程启动的 fail-closed 行为本身正确。

## 6. Dev Tunnel 当前唯一 root blocker

用户多次真实执行：

`platform setup --module dev-tunnel`

均失败：`SETUP_FAILED — devtunnel port JSON does not contain a valid port list`。

当前只读现场已确认：

```text
devtunnel path    = /usr/local/bin/devtunnel
devtunnel version = 1.0.2030+fc9273aa0f
login status      = Logged in / github
```

新建但无端口的 Tunnel 执行 `devtunnel port list <id> --json`，真实返回：

```json
{ "warning": "No ports found for tunnel ..." }
```

当前 ProFlow `parsePorts()` 不支持这个合法空端口 JSON，因此在 `ensurePort()` 前置读取处抛错。结论：`DEV_TUNNEL_JSON_COMPAT = BUG`，不是登录失败。

同时 setup 顺序为 `create Tunnel → ensurePort → 后续 host/public URL → 最终才写 setup.json`。因此在 ensurePort 失败时本地 ownership state 尚未持久化；下次 setup 又会创建新 Tunnel，形成 `DEV_TUNNEL_RETRY_IDEMPOTENCY = BUG`。

当前远端已观察到至少 3 个 `portCount=0` 的半成品 Tunnel：

```text
swift-fog-skzzjw8.jpe1
swift-chair-28k7rl1.jpe1
quick-chair-9rv1scq.jpe1
```

另有历史 `ai-agent-platform-mvp.eun1`，不得误删。当前**禁止删除任何 Tunnel**，保留远端现场给后续恢复/整改决策。

Dev Tunnel 还有 recovery UX residual：失败后 `platform status` 只说“尚未完成持久 Tunnel 自动配置”，下一步仍是同一个会失败的 `platform setup --module dev-tunnel`，没有解释“登录已正常、远端已有半成品、当前失败在 port JSON、应该如何恢复/清理”。

后续在未修根因前，不得继续重跑会创建远端资源的 dev-tunnel setup；否则可能制造更多 orphan。

## 7. Model Provider 当前真实结果与断层

用户执行 `platform setup --module model-provider-api` 时，Platform 没有直接收集输入，而返回 setup plan，要求用户执行：

`pnpm exec -- proflow-model-provider-api setup`

用户按提示输入 Provider URL：`http://192.168.0.108:8080/v1`，Provider 最终 READY。
当前 shared facts 已确认 inventory 包含：

```text
sayhelloproton/Qwen3.5-4B-MLX-4bit-no-think
mlx-community/Qwen3.5-4B-MLX-4bit
__apple_intelligence__
```

必须保持正确产品心智：这个 URL 是**整个 OpenAI-compatible Provider 服务入口**，不是 FAST URL 或 REASON URL。Provider 只负责协议验证和 inventory；`model-runtime` 后续根据真实 text/structured/reasoning/Vision 等能力 evidence 做 FAST/REASON mapping，模型名只能作为合格后的次级信号。

已确认架构接缝：`setupModulesThin()` 已支持 target `{ moduleRef, input }`，但 `handleSetup()` 当前只构造 `{ moduleRef }`。Platform 缺少“读取 Module `actionRequired/requiredInputs` → 统一交互收集 → 构造结构化 `context.input` → 再调用 adapter”的桥。

Provider `setupPlan()` 又硬编码 package-level：

```text
pnpm exec -- proflow-model-provider-api setup
pnpm exec -- proflow-model-provider-api verify
```

因此用户被迫离开 Platform CLI。与此同时 Platform/文档宣称“正常 setup 无输入，等待 Deployment-owned resolver 提供 endpoint”，但当前产品没有真实 resolver，形成 Spec / Product UX / Implementation 三者不一致。

当前 Provider package CLI 仍使用 `node:readline/promises` 与自写 raw-mode credential 输入，交互较原始。后续应由 Platform 统一承接专业 interactive prompt；Module adapter 只消费结构化 input，不应每个 package 自建独立用户 UI。

## 8. 当前 npm + pnpm 混合现场（必须保留）

原 Fresh Workspace install 由 Platform 选择 npm，工作区是 `package.json + package-lock.json + npm-managed node_modules`。

用户按 Platform 自己的 setup plan 执行 `pnpm exec -- proflow-model-provider-api setup` 后，真实终端出现：

- 多个 `@tomflow/proflow-*` 被判定为“由不同 package manager 安装”，移动到 `node_modules/.ignored`；
- pnpm 重新安装约 27 packages；
- 生成 `pnpm-lock.yaml`；
- 生成 `pnpm-workspace.yaml`；
- `pnpm-workspace.yaml` 写入本轮新发布版本的 `minimumReleaseAgeExclude`。

当前根目录同时存在：

```text
package-lock.json
pnpm-lock.yaml
pnpm-workspace.yaml
package.json（无 packageManager 声明）
node_modules/.ignored/@tomflow
```

当前 Platform `readWorkspacePackageManagerSelection()` 明确规定：同时发现 npm + pnpm lockfile 时抛 `PACKAGE_MANAGER_CONFLICT`。因此这不是表面 hygiene，而是产品提示导致的 P0 冲突现场。

本机 pnpm 版本已观察为 `11.21.0`。只记录本次真实行为，不把它泛化成所有 pnpm exec 场景。

**当前禁止清理这个现场**：不删 pnpm lock/workspace、不恢复 node_modules、不 reset 根工作区；后续先作为整改证据恢复权威状态，再由用户授权清理策略。

## 9. 当前最终人工状态

Model Provider 配好后，用户真实 `platform status` 已收敛为：

```text
17 配置已完成
1 根阻塞
5 下游等待
0 失败
0 个真实进程运行中
PLATFORM_READY=NO
```

唯一 root blocker：`dev-tunnel`。`model-provider-api` 已 READY / 外部资源可用；`execution-browser-extension` 已 READY；`model-runtime` 等待后续模型验证与 FAST/REASON 映射。

不要把这一状态写成整个平台 PASS；Real-3 Journey 尚未继续。

历史非阻塞 observation 仍保留：真实 `platform status` 曾导致 `.proflow/state/task.sqlite-shm` 内容/大小不变但 mtime 变化。它暴露旧 strict pure-read mtime 合同与 SQLite auxiliary file side effect 的语义问题，目前未裁决为必须整改，禁止自动修。

根工作区 Git hygiene 也必须保留：测试前为制造 Fresh Workspace 删除过 root tracked `package.json/pnpm-lock.yaml/pnpm-workspace.yaml`，当前根 workspace Git index/生成文件存在混合状态；这是测试现场，不要自动 reset/clean。

## 10. 原始人工验收 P1～P18 问题登记表（新 Chat / Work 不得省略）

本表保留本轮真实人工验收形成的**原始问题编号**。后续即使把多个问题合并成同一整改 Root，也不得删除或重新编号 P1～P18；每次整改计划、回归与最终 closeout 都应能反向映射到本表。

| ID | 真实问题 | 当前判断 | 已确认根因 / 证据 |
|---|---|---|---|
| P1 | `platform install` 安装前有“核验 23/23”，安装后又有“已验证 23 个已安装模块”，语义不同但展示像重复 | UX 问题，非阻塞 | 源码确认前者是 Registry candidate/descriptor 校验，后者是实际安装后的 dependency/version/descriptor 校验；功能不同，文案没有明确“安装前/安装后”阶段。 |
| P2 | `platform status` 中 `agent-gateway` 明明只缺 `dev-tunnel`，却还把已有 facts 的 `platform-host` 一起报成缺失 | **确认的诊断错误** | 真实 `.proflow` 已读回 `platform-host.endpoint / gatewayTransportCredentialFile / stateRoot = PRESENT`，而 `dev-tunnel.publicBaseUrl = MISSING`；当前 gateway 依赖检查/issue 文案把多个依赖合并成一条固定诊断。 |
| P3 | 为 Fresh Workspace 删除 tracked manifest 后，根 Git 出现 staged deletion + install 生成的新 manifest | 测试环境 hygiene 问题，当前现场保留 | 测试前人为删除 tracked `package.json / pnpm-lock.yaml / pnpm-workspace.yaml`；随后真实 install 又生成新 `package.json / package-lock.json`。不要自动 reset/clean。 |
| P4 | `platform docs` 一次刷 23 份完整内部 Module 文档，没有目录、过滤、当前状态导向，且混入内部术语/包级命令 | **明确 UX 问题** | `renderDocs()` 遍历全部 modules，没有 module filter/索引/状态导向；真实输出包含 package-level `pnpm exec`、Contract/Owner 等实现语义。 |
| P5 | 全量 `platform setup` 顺序不是新用户 onboarding 顺序；Browser、Tunnel、Model 等人类动作混在一起 | **明确交互设计问题** | 全量 setup 使用 dependency `graph.order`；用户真实看到 GitHub auth、Browser load unpacked、Provider setup 等动作交错，无法形成“当前只做一件事”的心智。 |
| P6 | 全量 `platform setup` 遇到 `ACTION_REQUIRED / FAILED` 后仍继续遍历后续模块，没有停在当前唯一人工动作 | **确认的 orchestration 问题** | `setupModulesThin()` 非 targeted 模式下在非 READY 后只设 `completed=false` 并 `continue`；只有 targeted module 才 break。正确产品行为应在第一个不可约人类动作/失败处 STOP。 |
| P7 | Browser Extension 放在 `.proflow/...` 隐藏目录，macOS Chrome chooser 默认看不到，普通用户无法直接选择 | **确认的安装 UX 缺陷** | materialize 路径为 `/Users/agent/Desktop/proton-workspace/.proflow/deployment/browser-extension/execution-browser-extension`；用户普通 chooser 无法选中，最后通过 `⌘⇧G` 输入完整路径才成功加载。 |
| P8 | Browser 安装虽然文字提到“开发者模式”，但没有把“先开启开发者模式”做成明确 prerequisite/gate | UX 问题 | 提示存在，但只是静态文字；没有在进入 Load unpacked 之前形成显式 gate/确认，也没有和隐藏目录步骤拆成清晰单焦点流程。 |
| P9 | `platform setup --module execution-browser-extension` 成功后打印“全部模块均已就绪”，实际只有当前 1 个 module READY | **确认的作用域错误** | `renderSetup()` 仅依据本次 result set 的 `needsAction=0 && blocked=0` 输出“全部模块均已就绪”，没有区分 targeted setup 与 full setup。 |
| P10 | Extension 在 `platform-host` 尚未启动时自动 `task.list`，产生 `Uncaught (in promise) TypeError: Failed to fetch` 红色扩展错误 | **确认的代码 bug** | Extension 启动执行 `void runObserverRecovery()`；其中 `await invokeTaskApplication("task.list", {})` 在 host 未启动时 reject，调用未 catch，外层 void 未观察 rejection。Pairing READY 仍成立，但正常 pre-start 不应留下红色错误。 |
| P11 | `platform setup --module dev-tunnel` 登录成功后仍失败：`devtunnel port JSON does not contain a valid port list` | **当前真实功能 blocker / 根因已确认** | 本机 `devtunnel 1.0.2030` 对无端口 Tunnel 的 `port list --json` 返回 `{ "warning": "No ports found for tunnel ..." }`；ProFlow `parsePorts()` 不支持该合法空端口形态。另已确认失败发生在 setup state 持久化之前。 |
| P12 | Dev Tunnel 失败后 `status` 只说“尚未完成持久 Tunnel 自动配置”，下一步仍是同一个会失败的 setup 命令，用户不知道怎么办 | **确认的诊断/恢复 UX 问题** | 真实登录其实正常，远端已有半成品 Tunnel，但本地无最终 setup state；status 没解释失败阶段、远端资源、恢复/清理策略，也未阻止用户继续制造 orphan。 |
| P13 | `platform setup --module model-provider-api` 没有在 Platform 流程里完成配置，而是把用户踢到 `pnpm exec -- proflow-model-provider-api setup` | **P0：Platform setup 输入桥缺失，根因已确认** | `setupModulesThin()` 已支持 `{ moduleRef, input }`，但 `handleSetup()` 只传 `{ moduleRef }`；Platform 没有“读取 requiredInputs/actionRequired → 统一交互 → 构造 context.input → 重调 adapter”的桥。Provider `setupPlan()` 又硬编码 package-level `pnpm exec`。 |
| P14 | Model Provider 包级 CLI 直接裸问 URL，没解释这是“整个 OpenAI-compatible Provider 服务地址”，不是 FAST 或 REASON 单个模型地址 | **确认的 UX / 心智问题** | 用户真实输入 `http://192.168.0.108:8080/v1` 后 inventory 同时发现 no-think、think、`__apple_intelligence__`。该 URL 是整个 Provider endpoint；FAST/REASON 应由 model-runtime 后续能力验证映射。 |
| P15 | 包级模型 CLI 交互原始，没有专业 prompt/选择/说明/校验体验 | UX 问题，需统一到 Platform | 当前 CLI 使用 `node:readline/promises`，credential 甚至自写 raw-mode stdin。后续方向不是简单美化 package CLI，而是 Platform 统一承接 interactive prompt，Module adapter 只消费结构化 input；prompt framework 选型留给整改阶段。 |
| P16 | 在 npm-managed Fresh Workspace 执行 Platform 提示的 `pnpm exec ...` 后，pnpm 又安装一套依赖，生成 `pnpm-lock.yaml / pnpm-workspace.yaml`，并出现 “installed by a different package manager → node_modules/.ignored” | **严重 P0：工作区污染 / 双包管理器问题，已真实复现** | 原 workspace 是 npm `package-lock.json + npm node_modules`；执行该命令后 pnpm 重新安装约 27 packages、移动 `@tomflow/*` 到 `node_modules/.ignored`、写 pnpm lock/workspace。问题由正常产品引导直接触发。 |
| P17 | 当前根目录同时存在 `package-lock.json + pnpm-lock.yaml + pnpm-workspace.yaml`，后续 Platform install/update/uninstall 会产生 package-manager conflict | **已从“风险”升级为确认的 P0 冲突现场** | 当前文件已机械读回同时存在；`readWorkspacePackageManagerSelection()` 明确在 `lockManagers.size > 1` 时抛 `PACKAGE_MANAGER_CONFLICT: multiple package-manager lockfiles are present: npm, pnpm`。当前禁止清理，以保留 evidence。 |
| P18 | `platform status` 会让 `task.sqlite-shm` 仅 mtime 变化；逻辑内容未变，但与“mtime 也必须绝对不变”的旧 pure-read 测试合同冲突 | 已记录，当前非 blocker / 合同语义未裁决 | 真实 observation：SHM content/size 不变，仅 mtime 改变。曾验证 SQLite `immutable=1` 虽可避免该 side effect，但会忽略 WAL-only 最新状态，因此不能作为通用修复。是否要求 auxiliary file mtime 绝对不变需单独裁决。 |

### 10.1 P1～P18 的当前覆盖状态

当前 18 项不是 18 个独立 root cause。已确认可合并为少量整改 Root，但**原始编号必须保留用于回归追踪**：

```text
Platform onboarding / interaction root → P4, P5, P6, P8, P9, P13, P14, P15
Dev Tunnel compatibility / recovery   → P11, P12 + retry orphan
Browser install / pre-start           → P7, P8, P9, P10
Diagnostics / presentation            → P1, P2, P4, P12, P14, P15
Workspace package-manager integrity   → P3, P16, P17
Read-only semantic contract           → P18
```

### 10.2 额外必须保留、但不占用 P1～P18 编号的确认事实

- Dev Tunnel retry 还存在**非幂等 / orphan 资源泄漏**：`create Tunnel → ensurePort 失败 → setup.json 未持久化 → 下一次 setup 再 create`；当前已观察到至少 3 个 `portCount=0` 半成品 Tunnel。它是 P11 的放大后果和独立 P0 root，不得因 P1～P18 原表未单列而遗漏。
- `Deployment-owned Provider resolver` 当前只是产品设计目标，真实产品里尚不存在；它与 P13 共同导致“Platform 不收 URL、resolver 又不提供 URL、最后逼用户跑 package CLI”的闭环断裂。
- 当前人工最终状态仍是 `17 配置已完成 / 1 根阻塞 / 5 下游等待 / 0 失败 / 0 进程`，唯一 root blocker 为 `dev-tunnel`；这不等于整体平台 PASS。

## 11. Frozen residual root grouping

### Severity P0 / 必须整改

1. Dev Tunnel 空端口 warning JSON 兼容。
2. Dev Tunnel setup retry 非幂等 / orphan Tunnel 泄漏。
3. Platform setup 缺 Module required input → unified interaction → `context.input` 桥。
4. 正常产品路径依赖不存在的 Deployment-owned Provider resolver。
5. 正常用户流程暴露 package-level `pnpm exec`。
6. `pnpm exec` 把 npm Fresh Workspace 污染成 npm+pnpm 双 package-manager。

### Severity P1 / 产品体验必须收口

1. 全量 setup 必须单焦点 onboarding，顺序面向用户而不是直接暴露 graph.order。
2. ACTION_REQUIRED/FAILED 后应 STOP，不继续拉起后续人工流程。
3. Browser hidden `.proflow` 目录与 Developer Mode prerequisite 引导。
4. targeted setup “全部模块均已就绪” scope 误导。
5. Browser pre-start unhandled fetch error。
6. Dev Tunnel recovery/diagnostic 文案不可操作。
7. Model Provider URL 心智不清。
8. Platform 统一专业 CLI prompt；Module 不自建面向用户的 package CLI 流程。
9. `platform docs` 不适合普通用户 onboarding。
10. status 对 agent-gateway 依赖过度报告。

### Severity P2 / 后续整理

1. install 前后验证文案。
2. Fresh Workspace root Git hygiene。
3. `task.sqlite-shm` mtime observation / pure-read semantic contract。

## 12. 最高执行边界

当前用户要求升级为最高优先级：

```text
ISSUE_DISCOVERY != FIX_AUTHORIZATION
```

固定顺序：

```text
发现问题
→ 先列出来
→ 再只读查清
→ 落盘记录
→ 向用户说明影响与建议
→ 等用户明确授权
→ 才允许整改
```

用户明确阶段边界（例如“发布完我要人工测试”“到这里停”）视为 `HARD STOP`。用户出现“停 / 不对 / 你在干什么 / 为什么又做了 / ?”等对执行方向的质疑时，进入 `IMMEDIATE_EXECUTION_FREEZE`；在重新授权前不继续推进型工具调用。

当前现场明确禁止擅自：

- 清 npm + pnpm 混合工作区；
- 删除 orphan Dev Tunnel；
- reset / clean 根工作区；
- 重跑会继续创建远端资源的 dev-tunnel setup；
- npm publish；
- git push；
- 因为发现 residual 而自动修实现。

## 13. 用户产品目标：Platform CLI 必须成为唯一入口

本轮人工验收最重要的产品反馈不是某一条报错，而是：**新用户心智负担仍然过重**。

最终产品入口必须满足：

```text
platform install
→ platform setup
→ platform start
```

用户不应该理解或手工处理中间实现细节：

```text
内部 Module/package CLI
npm vs pnpm 管理器切换
package-level pnpm exec
FAST URL / REASON URL
Tunnel ID / port / ownership
内部 shared facts / resolver seam
```

Platform CLI 应统一负责 discovery、当前 root prerequisite、交互提示、结构化 input、状态观察与下一步；Package owner 保留行为真值，但不应把自己的内部 CLI 暴露成正常产品 onboarding。

`platform setup` 的目标体验固定为：一次只处理一个当前最前置 root prerequisite；机器可完成的全部自动完成；到不可约人类动作时只展示一个专业、明确、可操作的步骤；完成后自动观察 READY，再继续下一个。

## 14. 下一 Chat 第一轮：只读恢复权威现场
新 Chat 接手后第一轮只做权威状态恢复，不立即修：

1. 读本文，再读 `05 / 14 / 15`；不得从历史段落覆盖本文最新状态。
2. 机械读取 source repo branch / HEAD / `git status --short` / ahead-behind。
3. 机械读取 `/Users/agent/Desktop/proton-workspace` 根目录当前 manifest/lockfile、Git index 与 `node_modules/.ignored`；**只读，不清理**。
4. 读取 `.proflow` 当前 module status/shared facts，敏感字段只判断 PRESENT/ABSENT，不输出 secret。
5. 只读执行 Dev Tunnel auth/list/port 观察，确认 orphan 数量与状态；不 create/delete/host。
6. **逐条对照第 10 节 P1～P18 原始问题登记表**，形成“仍可复现 / 已消失 / 新证据 / 归属 Root”矩阵；不得只看第 11 节 Severity P0/P1/P2 合并结果。
7. 先向用户提交包含 `P1～P18 → Root → 拟整改批次 → 回归证据` 映射的整改计划和 frozen residual list；用户确认后才进入实现。

整改继续遵循：

```text
CodeGraph-first
→ 当前磁盘源码验证
→ exact search 反查
→ 一次审完冻结范围
→ freeze root-cause list
→ 分批整改已授权 root
→ 一次 final validation
→ 原真实场景重放
```

不得随机继续人工测试；尤其 Dev Tunnel 根因未修前不得重跑 targeted setup。

## 15. 建议整改批次（只规划，不代表授权）

建议下一 Chat 把已确认 residual 重新合并成少量 root，而不是 18 个零散 UI patch：

```text
Batch A — Platform onboarding/input orchestration
Batch B — Dev Tunnel compatibility + ownership/recovery
Batch C — Browser pre-start + install guidance
Batch D — Diagnostics/docs/presentation
Batch E — Fresh Workspace package-manager recovery + final replay
```

具体文件、测试与是否涉及 resolver 架构裁决，必须由下一 Chat 先只读恢复后再向用户申请授权。
