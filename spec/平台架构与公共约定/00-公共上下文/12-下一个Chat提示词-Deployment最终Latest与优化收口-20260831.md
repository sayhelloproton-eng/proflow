# 下一 Chat 提示词｜Deployment 最终 npm latest + 优化收口

你现在接管 ProFlow Phase 3 的 Deployment Closeout 最后一段。

先读：

```text
/Users/agent/Desktop/proton-workspace/repos/proflow/spec/平台架构与公共约定/00-公共上下文/README.md
/Users/agent/Desktop/proton-workspace/repos/proflow/spec/平台架构与公共约定/00-公共上下文/05-执行纪律与工具规则.md
/Users/agent/Desktop/proton-workspace/repos/proflow/spec/平台架构与公共约定/00-公共上下文/10-Deployment-Closeout循环测试进度计划书.md
/Users/agent/Desktop/proton-workspace/repos/proflow/spec/平台架构与公共约定/00-公共上下文/11-Deployment最终Latest验证当前Chat交接-20260831.md
```

仓库：

```text
/Users/agent/Desktop/proton-workspace/repos/proflow
```

真实 Product Workspace：

```text
/Users/agent/Desktop/proton-workspace
```

不要重新讲计划，读完后直接执行。
## 当前权威事实

交接前机械恢复结果：

```text
Source HEAD = 57de2ad
commit = fix(browser): fail closed on stale live extension session
source tree = CLEAN

npm latest:
  @tomflow/proflow-platform-cli = 0.1.47
  @tomflow/proflow-execution-browser-extension = 0.1.21

Product Workspace:
  platform-cli = 0.1.47
  browser = 0.1.21
  npm-owned = YES
  package-lock.json = YES
  pnpm-lock.yaml = NO
```

Browser 0.1.21 已经在 Registry，**禁止再次 publish 0.1.21**。

当前平台是停机态：已知 5 个服务端口全部 DOWN。

Browser durable verification 已是 0.1.21；3 个 Final-Fresh GPT role identity 仍存在。
## 你的执行目标

第一阶段只做 **最新 npm Deployment 主链复核**，不要先优化 UX。

按这个顺序直接跑：

```text
1. npm Registry exact/latest readback
2. Product Workspace npm hygiene + npm outdated
3. ./node_modules/.bin/platform status
4. platform setup
5. platform start
6. 物理确认真实 owner / service listeners
7. Browser authenticated /v1/session/status
8. 验证 live extensionInstanceId == durable verification evidence
9. platform status 不得 Browser Fake READY
10. Dev Tunnel HTTPS reality
11. Model Provider / Runtime reality
12. 三个 GPT role validate / Gateway Bearer probe
13. repeat setup/start/status 最小幂等 smoke
```

Browser 0.1.21 的重点就是证明：

```text
Chrome restart / instance drift
→ status fail-closed
→ platform setup 自动 revalidate
→ evidence 刷新
→ online=true
→ status READY
```

不允许只看文件或历史 PASS。
## Deployment 主链 PASS 条件

只有下面全部成立，才可写本轮 latest Deployment PASS：

```text
npm latest / Registry exact = PASS
Product Workspace install/setup/start = PASS
Browser live reality = PASS
Dev Tunnel live reality = PASS
Model live reality = PASS
3 GPT carrier reality = PASS
status 与现实一致，无 Fake READY
最小 recovery / idempotency smoke = PASS
```

用户已明确：主链最终真实跑通后，即可把过程中发现的非阻断问题归入优化，不要让 UX polish 无限反向阻塞 Deployment。

## Deployment PASS 后再统一优化

当前已收集优化项见 11 文档 O1～O6，重点包括：

```text
install 23+23 默认输出过多
setup 23 个 skip 噪声
Dev Tunnel query 20~32s / timeout-retry UX
status “2 个真实服务进程” vs 实际 5 services 的计数/措辞
uninstall 成功措辞不自然
默认 CLI 应只显示状态 + 一个 root cause + 下一步
```

优化必须批量处理，不逐 Bug 发版。
## 工具与执行纪律

- 结构问题先 CodeGraph，再 Local Dev 当前源码验证。
- Product Workspace 是 npm-owned，只用 `./node_modules/.bin/platform`。
- publish/release UNKNOWN 时先 Registry authority；禁止盲重发。
- 0.1.21 已发布，绝对不要再次 publish 0.1.21。
- 不删除远端 Dev Tunnel。
- 不无意义删除/重建 3 个 GPT。
- 不打印 secret/token/credential。
- Browser 不伪造 Origin、heartbeat 或 extension instance。
- 已经验证过的 Chrome/macOS 原生操作复用仓库 SOP，不重新猜固定坐标。
- 长进程只启动一份，低频 poll；session 被回收就恢复 durable/process authority。
- 不 git push。
- 不静默修改 Frozen Contract / Owner / Architecture。

## 汇报纪律

每个有意义 Gate 通过/失败后，简短实时汇报，然后自动继续，不等用户确认。

不要因为“运行很久”“阶段差不多结束”“担心上下文”而主动停工。

当前 Chat 的最终任务：

```text
先把 npm latest Deployment 主链做完
→ 明确 PASS
→ 再统一处理优化 O1～O6
→ 必要时新版本发布
→ 最后一遍真实 npm latest Product smoke
→ 更新 02/10/11 等总控文档
→ 给出最终 Deployment 收口结果
```

现在直接执行。