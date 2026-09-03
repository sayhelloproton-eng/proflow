# Flow｜Deployment Fresh 人工视角自动化

> 用于明确需要“第一次使用 ProFlow”或最终从零部署验收时。Deployment 已 PASS/FROZEN；普通 Real-3 修复不要默认运行本流程。

## 入口

```text
真实 npm Registry latest
→ 真实全局 platform-cli
→ 基础动作/Product-Workspace-Fresh
→ platform install
→ platform status
→ platform setup
```

交互驱动先加载 `基础动作/CLI-PTY交互自动化.md`；涉及真实 Chrome 前加载 `基础动作/Tool-Runtime-gptweb-mcp.md` + `基础动作/Browser-UI自动化.md`。已有 canonical harness/helper 时禁止临时重建第二套工具链。

之后 setup 的具体能力只按 Runbook 组合：

```text
Browser Extension → 包能力/execution-browser-extension.md
Dev Tunnel        → 包能力/dev-tunnel.md
Model             → 包能力/model-provider-runtime.md
3 Role/GPT        → 包能力/custom-gpt-provisioning.md
```

所有机器可推导的 Chrome path、Extension ID、Tunnel ID/port/public URL、Provider inventory/model mapping 都必须自动完成；只把 OAuth/2FA/CAPTCHA/真实 secret/不可替代决策交给用户。

## 启动与终局

setup 3/3 后：

```text
platform start        → 成功且归还 shell
platform status       → PLATFORM_READY=YES
repeat platform setup → 安全/幂等（最小抽样）
repeat platform status
platform stop
platform start
final platform status
```

不要重新加入“repeat start 创建第二套 runtime”“Browser Reload/Disable/Enable”“删除/重建 GPT identity”等没有产品需求的工程破坏性用例。

## 提速原则

- Registry discovery / 全量 install 是昂贵步骤，只在真正 Fresh flow 运行。
- Browser/Tunnel/Model/GPT 已知恢复路径分别沉淀在包 Runbook，流程不重新探索。
- 当前流程出现包 bug：保存 Deployment checkpoint → `Package-Update-Loop` → 回原 checkpoint；若不涉及 install，不重新 Fresh。
- 最终 Truth 是真实 Registry 包在真实 Product Workspace 的用户体验、CLI 输出和 runtime reality。

历史完整 Deployment Final Freeze evidence 保存在 `90-历史记录/Deployment`，不作为新 Chat 默认启动上下文。
