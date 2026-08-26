# 配置自动化、技术问答与 OpenAI Secure MCP Tunnel 后续

更新时间：2026-08-26

## 1. 文档定位

本文是 Phase 3 当前唯一的**配置自动化盘点与技术问答入口**。它不重开 Real-1/Real-2，不替代五领域正式规范，也不把代码测试、候选实现或历史 evidence 提升为真实产品 PASS。

当前最高层状态：

```text
REAL_1 = PASS
REAL_2 = PASS / FROZEN
CURRENT_STAGE = REAL_3
MODEL_DOMAIN_CODE = PASS
REAL_EXTERNAL = ACTION_REQUIRED
PLATFORM_END_TO_END = NOT PASS
PHASE3_FINAL_GO = NO
```

2026-08-26 本轮核验起点：主仓 `main@a27afa9`、working tree clean。父工作区真实 `platform status` 读到 24 个模块：`20 READY / 2 ACTION_REQUIRED / 1 BLOCKED / 1 FAILED`。其中 `chatgpt-carrier` 仍输出旧人工 Carrier 语义，`model-provider-api` 仍要求 Base URL，`model-runtime` 等待 Provider，`dev-tunnel` runtime 为 FAILED。该输出证明**已安装产品与 main 源码存在交付漂移且平台真实链未闭环**，不证明这些源码能力回归。

## 2. 自动化审计结论

### 2.1 源码侧已经完成，不再重做

| 能力 | 当前事实 | 边界 |
|---|---|---|
| Chrome Runtime | 已存在则复用；macOS 缺失时自动安装官方 Stable Chrome | 不要求用户填写 executable path |
| Browser Extension | 自动准备 unpacked 目录、Bridge、身份与 hello/heartbeat；已有 live Extension 直接复用 | 首次 Developer Mode / Load unpacked 仍是 Chrome 安全边界内人工动作 |
| Custom GPT 三角色 | Extension 驱动 Private Create、Knowledge、Actions/Auth、能力配置、g-id/credential 落库与 Gateway probe | ChatGPT 登录/重新认证仍属于用户账号边界 |
| ChatGPT Carrier | 源码只观察 ChatGPT Web reachability，不再要求 GPT URL 或 capability checkbox | 父工作区已安装包仍是旧语义，必须通过正式交付消除漂移 |
| Microsoft Dev Tunnel | 登录检查、create/reuse、端口对齐、host、HTTPS URL、持久化与 shared facts 已自动化 | 登录失效时只保留 GitHub 浏览器授权 |
| Platform setup | 全量遍历、依赖 READY 门控、非 READY 聚合、定向 setup 重新观察 | Platform 不成为 Module config bus |
| Model Provider probe | generic HTTP(S)、`/v1/models`/`/models`、auth、inventory、secret reference 已实现 | 不负责发现设备、应用或产品 |
| Model Runtime | inventory drift、能力探测、FAST/REASON 映射、歧义 fail closed、runtime freshness、进程与 `/ready` 已实现 | 无真实 Provider 时只能 `ACTION_REQUIRED` |

### 2.2 仍需完成的自动化或工程闭环

#### AUTO-P0-01｜Deployment-owned Provider Endpoint Resolver

```text
Status: ARCHITECTURE_STOP
Owner: 尚未裁决
```

完整产品路径仍缺少一个由 Deployment composition 拥有的 bounded resolver，把机器可发现的 OpenAI-compatible Provider endpoint 交给 `model-provider-api`。当前 Adapter/CLI 会在缺 URL 时要求用户提供 Base URL；这只能作为独立诊断入口，**不能作为正常 `platform setup` 产品心智**。

约束：

- 不把 Bonjour/DNS-SD、MLXHub、iPhone 或其它产品识别塞进 Model Domain；
- 不要求用户填写机器可发现的 LAN IP、Base URL 或模型 ID；
- 不允许局域网盲扫；候选必须来自 bounded、可解释的 discovery source；
- 若需要新增第 25 个 Module、改变冻结安装顺序或放宽领域边界，先 STOP 做正式架构裁决；
- resolver 只产出 generic endpoint candidate/evidence，Provider probe 仍负责协议、认证和 inventory 真值。

这是当前唯一明确的**产品能力自动化缺口**。

#### AUTO-P0-02｜可区分版本的正式交付与安装回读

```text
Status: OPERATIONAL_CLOSURE_REQUIRED
```

main 源码与父工作区 installed packages 版本号相同但内容不同，导致源码已删除的提示仍出现在真实 `platform status/setup`。必须走新 patch version → release/publish → clean product install → package/dist SHA 回读，不能复制 `dist`、覆盖 `node_modules` 或把源码测试冒充产品测试。

这不是新增领域能力，但它是让现有自动化真正进入用户入口的必要工程闭环。未经明确发布授权，不 push、不 publish。

#### AUTO-P0-03｜交付后的整平台生命周期重放

```text
Status: REAL_E2E_REQUIRED
```

正式交付后必须从七命令入口重跑：

```text
install → status → setup → status → start → status
→ Chrome / public HTTPS exact business probe
→ model inventory / FAST / REASON / Vision / reasoning / inference
→ repeated setup / provider-off recovery
→ stop → status
```

当前 Dev Tunnel 曾有 exact-marker HTTP 200，只证明公网穿透能力；最终 Chrome/curl HTTP 502 证明 Gateway/local upstream 整链仍未通过。不能把 Tunnel PASS 写成 Platform E2E PASS。

#### AUTO-P1-04｜真实外部模型恢复闭环

```text
Status: BLOCKED_BY_AUTO-P0-01_AND_REAL_PROVIDER
```

resolver 与正式交付完成后，机器应自动执行 inventory、FAST/REASON、Vision、reasoning、重复 setup、server-off 降级与恢复、runtime inference。若没有可发现且真实可用的 Provider，正确结果仍是 `ACTION_REQUIRED`，不是要求用户提供机器事实，也不是 fake READY。

### 2.3 必须保留的人类动作

以下不是“自动化没做好”，而是账号、安全或明确用户意图边界：

1. GitHub 首次/失效后的 Dev Tunnel 浏览器授权；
2. ChatGPT 登录、重新认证及平台要求的账号确认；
3. 普通 Chrome 首次启用 Developer Mode 并 Load unpacked Extension；
4. Provider 明确返回认证要求时，安全提供一次凭据；
5. 多个候选全部通过同等能力证据且仍无法消歧时，在**已验证候选集合**内选择。

不得自动化读取浏览器密码、导出 secret、绕过第三方授权、静默选择有歧义的模型或伪造外部服务。

## 3. 技术问答

### Q1：单个 Module 测试通过，为什么还要跑 Platform CLI？

Module 测试证明 owning package 的合同与算法；Platform CLI 真实链证明 24 模块安装物、顺序、shared facts、生命周期和用户入口组合正确。两者是不同层，不能互相替代。最终验收必须走七命令，但定位单模块问题时应先跑 package-owned 命令与 targeted tests。

### Q2：为什么不能只看测试计数宣布 PASS？

单元/集成测试可以使用 fixture 或本地 fake Provider。真实 GitHub Auth、Chrome Extension、Custom GPT、Microsoft Dev Tunnel、公网 HTTPS、手机模型与 installed package bytes 都属于外部现实。没有实时 evidence 就只能写 `CODE PASS`、`ACTION_REQUIRED` 或 `NOT PASS`。

### Q3：Dev Tunnel 自动化部署后公网能访问，是否就算 Tunnel 通过？

是。对 Tunnel 自身，真实 setup 后能从公网 HTTPS 访问当前映射的本地端口，即可证明穿透能力。若访问返回 502，说明 Tunnel 可能已连接但上游 Gateway/local service 未监听；此时 `TUNNEL_PENETRATION` 的历史证据可以保留，但 `PLATFORM_END_TO_END` 仍不通过。

### Q4：GitHub 登录能否由测试或脚本“模拟授权”？

不能。脚本可以清除/检查登录、发起 browser auth 并在授权后复核 JSON 状态，但账号授权必须由真实用户在 GitHub 页面完成。没有出现授权动作时，不得声称完成 fresh-auth E2E。

### Q5：为什么正常 setup 不能向用户询问 Provider Base URL？

因为 LAN endpoint 属于机器可发现事实。正常产品应由 Deployment-owned resolver 发现并把 generic endpoint 交给 Provider Module；用户只处理认证或真实歧义。独立 CLI 的 `--provider-base-url` 只用于诊断、实验或 resolver 输出注入，不是最终产品流程。

### Q6：模型名能否直接决定 FAST/REASON？

不能。必须先通过 text、structured output、reasoning、Vision 等真实能力验证；模型名只能在能力合格后作为次级排序信号。多个合格候选仍歧义时才允许用户选择。

### Q7：时间过去 24 小时是否自动让模型映射失效？

不能仅因 wall-clock 流逝失效。inventory fingerprint、Provider/runtime availability 或能力 evidence 漂移才触发 stale/revalidation；若另有 freshness policy，必须来自已冻结合同并能解释，不得用任意 TTL 替代现实观察。

### Q8：`model-provider-api` 为什么是 `runtimeStatus=NOT_APPLICABLE`？

它治理的是外部 Provider API，不拥有远端进程。API 当前可用属于 external availability/setup evidence，不等于 ProFlow 启动了一个 Provider runtime。

### Q9：为什么不能直接发包或覆盖 `node_modules` 来测试？

发布会改变外部 Registry，覆盖安装物会绕过真实交付路径并制造无法复现的结果。测试源码候选可以在仓库中完成；产品验收必须使用可区分版本的正式发布/安装，且发布需要明确授权。

### Q10：浏览器验证应该怎么做？

需要真实网页时采用“动作 → 实时截图/DOM 观察 → 判断 → 下一步”。截图必须对应当前页面和当前动作；历史截图、日志文字或推测不能代替 live evidence。timeout/UNKNOWN 后先重新观察，禁止 blind retry。

### Q11：`platform start --module model-runtime` 是否是合法命令？

不是。Platform 一级合同只有七命令，`start/stop` 不提供定向 Module 路由。模型正常启动必须走全平台 `platform start`；package-specific process entrypoint只用于 owning Module 内部实现或诊断，不能扩展 Platform surface。

### Q12：OpenAI Secure MCP Tunnel 能否直接替换 Microsoft Dev Tunnel？

不能。当前 Custom GPT Actions 依赖通用公网 HTTPS REST Gateway；Secure MCP Tunnel 是 MCP 通道，不提供这一 unchanged ingress contract。Phase 3 保留 Microsoft Dev Tunnel，不重开架构。

## 4. OpenAI Secure MCP Tunnel 裁决

```text
TUNNEL_FIRST_REVIEW = NOT_COMPATIBLE
TUNNEL_SECOND_REVIEW = CONFIRMED_NOT_COMPATIBLE
OPENAI_SECURE_MCP_TUNNEL_DIRECT_REPLACEMENT = NO
MCP_MIGRATION_NOW = NO
MICROSOFT_DEV_TUNNEL = KEEP_FOR_PHASE3
```

这一裁决只在 Custom GPT Actions / Agent Gateway 公网 HTTP 合同发生正式变更后才允许重开。

## 5. 当前机械顺序

1. 先裁决 `AUTO-P0-01` 的 Deployment owner；若需要新增 Module/改变 24 模块顺序，STOP 进入架构变更。
2. 决定新 patch version 与正式交付方式，获得授权后再 publish/install，消除 installed drift。
3. 回读 24 个实际安装包版本与关键 dist SHA，确认不是旧包。
4. 走七命令完整链，并用 Chrome/HTTPS 实时证据验证 Gateway → Tunnel。
5. resolver 找到真实 Provider 时执行完整模型能力与恢复矩阵；找不到则保持 `ACTION_REQUIRED`。
6. 只有 Real-3～Real-6 的真实证据全部完成后，才允许重新裁决 `PHASE3_FINAL_GO`。

## 6. 关联真源

- 当前总控：[02-当前总控状态与Real路线.md](02-当前总控状态与Real路线.md)
- Real-2 冻结：[13-Real2-最终冻结与Real3交接.md](13-Real2-最终冻结与Real3交接.md)
- 当前完整交接：[15-当前上下文与Tunnel任务流转-20260825.md](15-当前上下文与Tunnel任务流转-20260825.md)
- Model Provider 规则：[../../模型与推理领域/03-流程与数据/02-Model-Capability-Profile与Provider适配.md](../../模型与推理领域/03-流程与数据/02-Model-Capability-Profile与Provider适配.md)
- Deployment 限制：[../../部署领域/06-状态与实施/KNOWN-LIMITATIONS-AND-SPIKES.md](../../部署领域/06-状态与实施/KNOWN-LIMITATIONS-AND-SPIKES.md)

后续 Chat 读取 `13 + 14 + 15` 即可获得 Real-2 冻结、技术问答/自动化审计和当前执行状态；不得恢复已删除的重复 `16` 交接文件。
