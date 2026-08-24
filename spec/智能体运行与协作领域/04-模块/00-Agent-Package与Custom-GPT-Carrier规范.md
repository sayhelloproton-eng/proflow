---
docId: AGENT-DOC-04-00
title: 智能体运行与协作领域｜Agent Package 与 Custom GPT Carrier 规范
docType: module-design
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 智能体运行与协作领域｜Agent Package 与 Custom GPT Carrier 规范

> v1 目标：让三个 Agent Package 提供完整、版本化的 Custom GPT Provisioning material；在平台部署期，由已安装的 ProFlow Browser Extension 通过真实 ChatGPT GPT editor 确定性创建/更新三个 Private Custom GPT，并把真实角色注册到平台。当前仍不依赖任何 Custom GPT management API；自动化发生在真实 Web editor，而不是未公开管理接口。

---

# 1. Agent Package 定位

Agent Package 不是“Prompt 文件夹”，也不是运行时 Worker。

它是：

> **Agent 的可版本化定义 + Custom GPT 配置材料 + Carrier setup CLI + Role 本地注册工具。**

第一版实际 Carrier：

```text
custom-gpt
```

未来允许增加：

```text
opencode
codex
claude-code
self-hosted
```

但这些不是 v1 实现范围。

---

# 2. package.json 是 Agent manifest 真源

v1 **不创建 `agent.manifest.json`**。

Agent manifest 信息放入 npm `package.json` 的平台命名字段中，避免重复真源。

示意（字段名最终需服从部署领域 Module Contract，不把本例当作公共 Schema 冻结）：

```json
{
  "name": "<agent-package-id>",
  "version": "1.0.0",
  "description": "总控、项目管理与研发角色",
  "aiAgentPlatform": {
    "kind": "agent-package",
    "agent": {
      "displayName": "总控 = 项目管理 + 研发",
      "conversationStarters": [
        "查看我当前可以处理的任务"
      ],
      "instructions": "# 角色职责\n...Markdown...",
      "carrierProfiles": {
        "custom-gpt": {
          "recommendedModel": "gpt-5-6",
          "capabilities": {
            "webSearch": true,
            "imageGeneration": false,
            "codeInterpreter": true
          },
          "requirements": {
            "actions": "required",
            "fileBridge": "required",
            "apps": "disabled"
          },
          "knowledgeBundle": "knowledge/custom-gpt-knowledge.zip",
          "actionSchema": "actions/custom-gpt.openapi.yaml"
        }
      }
    }
  }
}
```

确认语义：

- GPT 名称/展示名称：来自 package.json Agent 字段；
- GPT 描述：来自 package.json；
- 对话开场白：来自 package.json；
- Instructions：Markdown 字符串，来自 package.json；
- 不再额外建立 `instructions.md`；
- 不再额外建立 Agent manifest 文件。

---

# 3. 长期资料与部署 Knowledge Bundle

v1 明确区分 package authoring material、部署期静态 Role Knowledge 与运行期动态 Task Context：

```text
context/fixed-context.md                    # package authoring/reference material
memory/memory.md                           # package authoring/reference material
knowledge/custom-gpt-knowledge.zip         # v1 REQUIRED deployment asset
TaskDocument / Artifact / File Bridge      # runtime dynamic context；绝不进入永久 Knowledge
```

## fixed-context.md / memory.md

二者继续保存角色长期职责解释、稳定边界、长期经验与操作约定，主要用于维护 Agent Package 的 Instructions 与静态知识资产；它们不是新的运行时 Context Store，也不自动要求逐文件上传。

## knowledge/custom-gpt-knowledge.zip

三个固定 Agent Package 都必须携带同一路径的 `knowledge/custom-gpt-knowledge.zip`。ZIP 是 **Agent Package 的版本化部署资产**，不是直接上传给 ChatGPT 的最终文件格式。

部署时由 Agent Package / Mac setup 侧：

```text
读取 ZIP
→ 安全解压到临时 staging
→ 拒绝 zip traversal / symlink escape / 不支持的文件类型 / 越界大小
→ 生成文件名、MIME、size、hash 清单
→ 通过 Deployment Provisioning file transport 把 bytes 提供给 Browser Extension
→ Extension 将解压后的受支持文件上传到 GPT Knowledge
→ 等待 Carrier processing completed
→ 校验编辑器中对应 Knowledge 文件存在
```

当前基线允许 ZIP 内仅放一个稳定 smoke-test 文件，用于证明 Knowledge 在真实 GPT 中可检索；未来只需替换 ZIP 内容并发布新的 Agent Package 版本，不要求修改 Provisioning 代码。

Custom GPT 的行为规则、职责、流程和安全边界仍必须由 Instructions 提供；Knowledge 只保存静态长期参考材料。Task Requirement / PRD / Technical Design / Test Result 等动态正文永远禁止进入永久 Role Knowledge，它们继续通过 TaskDocument / Artifact / File Bridge 按当前 Worker 需要获取。

---

# 4. Custom GPT Action Schema

## 4.1 v1 决策：静态写死

第一版不实现：

```text
Capability Catalog
Capability Discovery
Schema Composer
动态 Action 裁剪
按工作区实时组合 OpenAPI
```

每个 Agent Package 直接自带一份固定 Schema：

```text
actions/custom-gpt.openapi.yaml
```

不同角色包可以拥有不同 Action 集合。

## 4.2 允许的部署态替换

静态 Schema 可以保留实例占位符 / setup 生成步骤来替换：

```text
Gateway / Dev Tunnel public URL
必要的版本前缀
```

认证 Key 不写入 OpenAPI 文本。

Action 路径、`operationId`、参数、响应、角色可见能力集合在 v1 随包版本固定。

## 4.3 Action 设计规则

避免：

```text
updateTask
updateNode
changeStatus
advanceTask
executeAnything
```

优先围绕业务目的：

```text
getTask / getNodeContext
startNode / completeNode / waitNode / reopenNode
askPeer / replyPeer
requestExecution / getExecution / readExecutionOutput
TaskDocument / Artifact File Bridge
```

底层 `readFile/writeFile/git/process/network/browser` primitive 可保留在 Execution capability registry，但不要求全部平铺为 GPT 高频 Actions。

模型负责选择意图，但服务端负责最终合法性。

---

## 4.4 OpenAI Carrier requirements 与静态 Schema 约束

`requirements` 是 Agent Package 对 Carrier 的部署要求，不新增 Capability Service。角色可以按职责声明：

```ts
interface CustomGptCarrierRequirements {
  actions: "required";
  fileBridge: "required" | "optional";
  codeInterpreter: "required" | "optional";
  webSearch: "required" | "optional";
  apps: "disabled";
}
```

推荐第一版：

```text
产品：Actions required；File Bridge required；Web Search required；Code Interpreter optional
总控/研发：Actions required；File Bridge required；Code Interpreter required；Web Search required
测试/运维：Actions required；File Bridge required；Code Interpreter required；Web Search optional
```

三个固定 Agent Package 的当前部署基线统一声明 `recommendedModel = "gpt-5-6"`（GPT-5.6 Sol 高级思考模型），由 Agent Package 真源提供、由 Provisioning Driver 确定性选择；Extension 不写死角色模型。该字段仍是 Carrier recommendation，而不是服务端安全前提：Role READY 依据真实 GPT/Role、required capabilities、Knowledge、Actions/auth、Gateway 与真实 E2E，不把精确 model id 当授权或业务正确性依据。

每个 `actions/custom-gpt.openapi.yaml` operation 必须：

```text
operationId 稳定
参数窄且 typed
显式 x-openai-isConsequential
不依赖 Custom Headers
遵守 OpenAI description 长度限制
```

需要 Conversation 文件输入的 operation 才声明 `openaiFileIdRefs`；文件输出使用 response 的 `openaiFileResponse`，不把它设计成新的业务 Action。

Task 动态文档仍禁止上传到永久 Knowledge；应由当前 Worker Conversation 通过 Action/File Bridge 按需取得。

# 5. Custom GPT Web 创建字段映射

CLI 必须逐项对应真实 Web 配置：

| Web 配置 | Agent Package / Owner 真源 | 部署期动作 |
|---|---|---|
| 名称 | package.json | Provisioning Driver 自动填写 |
| 描述 | package.json | Provisioning Driver 自动填写 |
| 对话开场白 | package.json | Provisioning Driver 自动填写 |
| Instructions | package.json Markdown field | Provisioning Driver 自动填写并读回校验 |
| Knowledge | `knowledge/custom-gpt-knowledge.zip` | Mac 安全解压后由 Provisioning Driver 上传受支持文件并等待处理完成 |
| 推荐模型 | package.json carrier profile | 自动选择当前 material 声明值；三个固定 Agent 当前为 `gpt-5-6` |
| 功能开关 | package.json carrier profile | 自动设置并校验 |
| Actions Schema | static OpenAPI + current Gateway URL | 自动创建/更新 Action 并写入 Schema |
| Action Auth | Agent Domain 生成的 role-scoped Bearer key | Role 注册后由 Driver 机械填入；Extension 不拥有、不生成、不持久化 Key |
| File Bridge | OpenAPI `openaiFileIdRefs/openaiFileResponse` contract | Preview/E2E verify |
| Code Interpreter / Web Search | carrier profile requirements | 自动按角色 requirements 设置 |
| Apps | `disabled`（v1 使用 Actions） | Provisioning 必须保持禁用 |

Provisioning 默认将新 GPT 保存为 `private / 只有我`；不把公开分享、Marketplace 发布或组织分发作为部署完成条件。

2026-08-11 当前外部平台事实基线：Custom GPT 创建/编辑通过 ChatGPT GPT editor 完成；Knowledge 是上传文件；Actions 使用 OpenAPI JSON/YAML，并支持 API key / Bearer 等认证。当前设计不依赖未公开的 GPT 管理 API。

---

# 6. Package-specific management surface

标准部署主路径是 `Module.setup`；Platform 只按依赖顺序转发。Agent Package 的 extra CLI 用于 material inspection、诊断、恢复和显式本地管理，**不是另一套人工部署流程**。

## 6.1 Custom GPT material / finalization

当前 v1 机器能力收敛为：

```text
custom-gpt setup [--workspace ...] [--gateway-url ...]
custom-gpt show-name
custom-gpt show-description
custom-gpt show-instructions
custom-gpt action-schema --gateway-url ...
custom-gpt finalize-role --workspace ... --carrier-url ...
```

`custom-gpt setup` 的职责是输出完整、版本化 Provisioning material；它不自行伪装成完整 Web 自动化。`Module.setup` 组合 Agent Package material 与 `custom-gpt-web-provisioning` Contract，完成真实 GPT materialization。

`custom-gpt finalize-role` 接收 Provisioning Driver 返回的 live `carrierUrl`，调用 Agent owner 完成 Role 注册、读取 owner-managed credential、通过 Extension 做一次 ephemeral Auth finalization，并执行 owner/Gateway validation。该命令不得输出 credential。

若 Extension 未安装、未登录 ChatGPT、页面合同变化、Knowledge 处理失败或 Carrier 不允许创建 GPT，必须返回明确的 ACTION_REQUIRED / FAILED reality；禁止静默降级回人工复制 URL / Schema / Bearer 后假装 READY。

## 6.2 Role 管理命令

```text
role register <gpt-url>
role show
role list
role validate
role delete
role key show
role key rotate
```

确认：

- Role/credential 的 canonical owner 是 Agent Domain；严格 `registerRole`、deployment-only `saveCurrentRole`、`showCredential/...` 都是 owner capability；
- CLI 只是该本地管理能力的显式入口之一，不是 Deployment 唯一调用方式；
- `role delete` / `role key ...` 是本地管理命令，不是 GPT Action；
- v1 不提供通用 role update / replace API；普通 `registerRole` 继续拒绝同 package 重复注册。只有明确重新创建角色且新 GPT 已真实 `LIVE_CREATED` 后，Deployment 才可用 `saveCurrentRole` 原子替换同 package 当前 Role/credential；该能力不是 active Task Role migration，也不改变正常 setup retry / package upgrade 复用现有 roleRef 的规则。

---

# 7. Role 注册后的两阶段认证流程

因为 Key 与真实 `roleRef` 绑定，Provisioning 必须保持真实顺序：

```text
Provisioning Driver 创建/更新并确认 live GPT
→ 返回真实 g-id / carrierUrl
→ Agent Domain 持久化当前 Role（严格 registerRole 或 deployment-only saveCurrentRole）
→ 生成并持久化 Role 专属 Bearer Key
→ owning setup 临时读取本次 credential
→ 通过受限 Provisioning transport 交给 Extension
→ Extension 重新打开对应 GPT editor
→ Action Authentication = API Key / Bearer
→ 机械填 Key 并 Update
→ 丢弃 Extension / command 中的临时 secret material
→ owner inspect + Gateway authenticated probe
```

Auth 语义、Key 生成与 secret persistence 始终属于 Agent Domain；Browser Extension 只执行 Web materialization，不得把 Role Key 写入扩展静态资源、`chrome.storage`、runtime config、日志或 Evidence。

---

# 8. validate-role 能验证什么

由于 v1 不依赖 Custom GPT management API，`validate-role` MUST NOT 通过伪造管理读回声称拥有 OpenAI 官方配置 API。但部署期 Browser Provisioning 可以对它刚刚操作的真实 editor 做 DOM/reality verification，并把 bounded verification result 返回给 owning setup 流程。

必须联合验证：

- 本地 package → role 一对一；
- roleRef / URL 解析合法且 live GPT reality 已确认；
- Role Registry 完整；
- role-scoped Key 存在且 Gateway 可以识别；
- Action endpoint / health 可达；
- static OpenAPI 本地校验通过；
- package version 与 registry 记录一致；
- Provisioning 对 Instructions / recommendedModel / required Capabilities / Knowledge files / Action Schema / Auth Update 的实际页面写入已完成并通过对应 readback/reality check；
- 至少一次真实 Carrier → Gateway 身份探针 PASS。

若 editor 页面合同变化导致某字段无法确定验证，必须明确失败或 ACTION_REQUIRED；不能把未知配置当 READY。

---

# 9. Agent Package SemVer

三级版本规则确认：

## patch

- 文案修正；
- Instructions 非语义破坏性修正；
- 不改变角色职责 / API Contract。

## minor

- Knowledge Bundle 的兼容性内容增补或专业化增强；
- 兼容性的 Action 增加；
- 能力增强但旧配置仍可使用。

## major

- 角色职责发生不兼容变化；
- Action Contract 不兼容变化；
- Carrier 配置出现不兼容变化。

升级 Agent Package 不创建新的“逻辑 Agent”，也不自动生成新 roleRef。

包升级后：

```text
CLI 检查 registry registeredPackageVersion
→ materialize 新版本 Provisioning material
→ Browser Provisioning 自动 Update 现有 GPT
→ 对变更字段/Knowledge/Action 做真实 readback/reality check
→ 本地确认 registeredPackageVersion
```

升级同步必须优先复用现有 roleRef；不得因普通 package upgrade 自动创建第二个 GPT。

---

# 10. 与 Deployment Domain 的关系

所有 Agent Domain 独立包都必须遵守统一 Module Governance，同时**包自己负责自身部署闭环**。

每个 Agent Package 提供标准七能力：

```text
install
uninstall
status
setup
docs
start
stop
```

其中 `Module.setup` 的最终 Real-2 合同是自身 Custom GPT 的完整、可重入部署闭环：materialize Agent Package → 请求 Browser Extension 的 deployment provisioning capability → 创建/更新真实 Private GPT → 注册 Role → 动态生成 Role credential → 完成 Web Auth materialization → validate。`Module.status` 仍是唯一 management 状态真源。`custom-gpt ...`、`role register/show/validate/delete`、`role key ...` 等命令仍是 Agent Package 自身真实 extra capability，可以被 AI/用户直接调用，但 Platform 不代理、不解释其业务语义。

B1～B5 封板只冻结上述链路的 package material、Provisioning transport/driver、Role owner 与 Auth finalization primitive；**完整 `Module.setup` 编排、重入/中断恢复与 no-duplicate reality proof 属于 Real-2 B6 验收范围**。B6 未 PASS 前不得因为底层 primitive 已 GREEN 就宣称整条 `platform setup` 已真实验收通过，也不得为了绕过该缺口恢复人工复制粘贴 happy path。

总 Deployment 只做：

```text
发现 Module
→ 按 provides/requires 排序
→ 转发标准 Module command
→ 聚合结构化结果
```

Platform 不实现 ChatGPT 页面自动化、Carrier/Role 业务逻辑或 Auth 语义；这些由 owning Agent Package 与 Browser Extension deployment provisioning adapter 协作完成。Platform 只依据模块依赖确保 Provisioning capability 先 READY，并继续保持无 config bus、Plan/Apply 或跨模块 ACTION_REQUIRED resume state machine。再次执行 setup 时由 owning Module 重新观察真实现实并只补缺失/漂移步骤。

最终 package discovery metadata、descriptor/adapter、bin/exports 与结构化结果仍必须服从 Deployment Module Contract / Conformance；这些工程约束不得反向重写 Agent 业务语义。


---

# 11. 2026-08-14 Carrier Reuse First 对齐

### Product Package

Product GPT 主路径不再暴露 `createTask/listRegisteredRoles/getRegisteredRole`。Extension New Task 先创建 PENDING Task并建立三 Worker，Product只负责该 Task 内 Requirement/TaskDocument 与后续 Collaboration。

### Worker Turn

一个 WAKE 后允许同一 Conversation 连续调用多个 Actions；Agent Package Instructions 必须禁止把“每 Action 后等待 Browser 再输入继续”写成工作流。

### Native capabilities

```text
public research → Web Search
多文件/数据分析 → File Bridge + Code Interpreter
正式平台事实 → Actions
真实 effect → Execution
```

### Action permission

Routine query/control/intent operation 明确 `x-openai-isConsequential:false`，以用户首次 `Always Allow` 后退出 happy path 为目标；unexpected permission prompt 保留为 Carrier recovery。Execution Approval完全独立。

### Knowledge

v1 三个 Role 继续保持泛化岗位，但每个 Agent Package 必须携带并部署一个版本化 `knowledge/custom-gpt-knowledge.zip` 作为静态 Role Knowledge 基线。该能力不引入 Knowledge Service/Router/Registry；运行期 Task 动态上下文仍完全走 TaskDocument / Artifact / File Bridge。
