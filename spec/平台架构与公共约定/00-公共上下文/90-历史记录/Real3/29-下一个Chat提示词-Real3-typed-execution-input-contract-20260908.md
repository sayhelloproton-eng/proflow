# 29｜下一个 Chat 提示词｜Real-3 typed Execution input contract｜2026-09-08

把下面整段作为下一 Chat 的开场提示词。

```text
继续 ProFlow Phase 3 / Real-3 / J4 Integration Hardening，从最新 CURRENT 正式接手，不回退到旧 0.1.20/0.1.21 假设。

仓库：
/Users/agent/Desktop/proton-workspace/repos/proflow

Product Workspace：
/Users/agent/Desktop/proton-workspace

先按顺序读取：
1. spec/平台架构与公共约定/00-公共上下文/README.md
2. spec/平台架构与公共约定/00-公共上下文/02-当前接力/CURRENT.md
3. CURRENT.REQUIRED_CONTEXT
4. spec/平台架构与公共约定/00-公共上下文/90-历史记录/Real3/28-Real3-typed-execution-input-contract-当前Chat交接-20260908.md

你是 Real-3 总控。先机械回读 authority，再执行；不要根据旧聊天摘要直接 mutation。

当前冻结目标：
J1/J2/J3 PASS；J4 PAUSED；REAL_3 NOT_PASS。
保持 SAME Task / SAME Dev Worker / runNo=1，不新建 Task/Worker/Conversation。
```
```text
当前机械真值（接手后仍需回读）：
HEAD = 7bcc1ab37fc49b4a01ed7a08a8728e63f1eadfd3
Provider http://192.168.0.101:8080/v1/models = HTTP 200
41705/47080/51443 LISTENING
Product execution-contracts=0.1.10
Product platform-host=0.1.21
Registry execution-contracts@0.1.11 PRESENT
Registry platform-host@0.1.22 PRESENT

Task task-a6f859c00b1accd027d53d48 = WAITING v15
Dev = WAITING v10 / runNo=1
Dev worker = 6a9b4632-ca8c-83e9-a4bc-9de9e229e515
Test = PENDING v1
latest event = event:17 NODE_WAITING
pending blocker = message-bd7135c3-d472-4a23-8b9c-dc010c0c7789
Task Execution count = 7
durable file.read = 0

真正根因已由真实 ChatGPT Conversation Action wire payload 证明：
executeCapability 请求的 taskId/nodeId/runNo/capability=file.read 都存在；整个 input 字段缺失。
旧 agent-controller-dev 0.1.16 Conversation snapshot 不知道 file.read typed input 需要 path，且 Worker 不猜未公开参数，所以省略 input。
此前“scope 字段缺失”假设已被否定，不得重复。
```
```text
正确修复：
commit 94cec4fe05d3 fix(execution): expose typed capability input contracts
commit 7bcc1ab37fc4 chore(release): version execution contracts and platform host

execution-contracts 从唯一 canonical Zod capabilityInputSchemas 自动导出 executionCapabilityInputJsonSchemas。
platform-host getNodeContext 同时公开 executionCapabilityIds / executionRequestContext / executionCapabilityInputSchemas。
file.read schema 明确 required=[path]，不复制第二套 contract，不放宽 exact-node admission。

已通过：
execution-contracts 9/9
execution-contracts typecheck
B1-HOST-EXEC-01
platform-host 58/58
platform-host source-mapped typecheck
Biome
diff-check
canonical targeted build
release-sync

但交接前发现新的 artifact gate：
node scripts/publishability.mjs execution-contracts platform-host
最终 FAIL：published binary smoke failed: proflow-platform-host
tarball pack + isolated npm install 已进行到 binary smoke；源码和本地 dist CLI 都明确支持 --help/exit0。
所以分类仍 UNKNOWN：REAL_ARTIFACT_BUG vs PUBLISHABILITY_HARNESS_FALSE_NEGATIVE。
不要称 PASS，不要盲 republish。
```
```text
第一动作：
在任何 Product mutation 前，复现 packed isolated proflow-platform-host --help，完整捕获 exit/stdout/stderr/module resolution；机械分类 artifact failure。

若 artifact 健康：
1. freeze SAME-SCENE + Product installed 0.1.10/0.1.21 + Execution count=7/file.read=0。
2. formal platform stop。
3. targeted adopt BOTH execution-contracts@0.1.11 + platform-host@0.1.22。
4. exact installed readback。
5. Provider/23 setupStatus READY。
6. 写新的 restart acceptance，然后 exactly one platform start；timeout/UNKNOWN 只恢复 authority，不盲重发。
7. 验证 running getNodeContext 的 executionCapabilityInputSchemas["file.read"].required=["path"]。
8. 正式 Task owner ACK event17 pending blocker，再 resume SAME Task；禁止手工 worker.wake。
9. Observer 自动 wake SAME Dev。
10. 真实验收必须看到 old SAME Worker Action payload：capability=file.read + input={path:"repos/proflow/package.json"}。
11. durable file.read Execution 必须真实创建并 SUCCEEDED/APPLIED，得到 package name/version evidence。
12. Dev SUCCEEDED -> Test 独立验证 -> Task SUCCEEDED -> J4 PASS -> REAL_3 PASS。
13. 结束后沉淀最终 root cause、legacy Custom GPT Action compatibility、以及吞吐优化规则到 owning Runbook + CURRENT + History；commit，不 push。

禁止：
- 新 Task / Worker / Conversation
- manual wake / manual file.read retry
- direct SQLite mutation
- Browser/Tunnel 旧问题重查
- LAN discovery
- blind publish/update/start/stop retry
- push

执行纪律：
INVALID_REQUEST 且 durable Execution 不存在时，优先拿真实 Action payload，禁止再用“高概率字段猜测”直接发版。
一旦 contract boundary 被证据锁定，就冻结 Browser/Tunnel/Model 等已 PASS 域。
使用 CodeGraph 先缩 blast radius，Local Dev 做真实源码/测试/产物/运行证据；批量 snapshot，非幂等操作必须 durable PID/log/result。
```
