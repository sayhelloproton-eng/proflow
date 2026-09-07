# CURRENT｜Phase 3 当前接力

> 更新时间：2026-09-08。这里是下一 Chat 的唯一滚动执行入口；历史过程见 `90-历史记录/Real3/`。

## CURRENT_STAGE

```text
ARCHITECTURE = FROZEN
REAL_1 = PASS
REAL_2 = PASS / FROZEN
DEPLOYMENT_SUCCESS = YES / FROZEN
J1 = PASS
J2 = PASS
J3 = PASS
J4 = PAUSED_FOR_INTEGRATION_HARDENING
REAL_3 = NOT_PASS
PHASE3_FINAL_GO = NO
CURRENT_EXECUTION_MODE = REAL_3_J4_EXTENSIONS_PAGE_CANONICALIZATION_HARDENING
```

0.1.49 的真实 SAME-SCENE 失败根因已经机械证明，trailing-recovery fix 已发布为 0.1.50，Registry / Product Workspace / materialization 均已采用 0.1.50。第二轮 recovery adoption 已消耗唯一 targeted setup，但 fresh Browser pre-attestation 发现 canonical helper 停在 `chrome://extensions/?errors=<target-id>`：截图和 AX 均未见目标 Extension card，因此按 fail-closed gate 未调用 `reload-at-point`。setup 最终 `PAIRING_TIMEOUT`，Chrome/verification 仍为 0.1.49/旧 instance，`platform start` 仍未准入且未执行。

## CURRENT_AUTHORITY

```text
branch = main
current context commit before this gate = b80b965 docs: record recovery adoption pre-attestation stop
worktree at last frozen context = CLEAN
Browser Reload harness hardening acceptance first frozen in context commit = 48b7912
Browser Reload harness FIX_COMMIT = 3d1eb52 fix(browser-harness): harden extension reload targeting
0.1.50 release commit authority = 0662615 chore(release): version execution-browser-extension
0.1.50 source commit base = 112fee7 docs: hand off Real-3 integration hardening
0.1.49 release commit = 6e9b51a chore(release): version execution-browser-extension
0.1.49 source fix = 5464f7d fix(browser): rearm observer recovery on bridge reconnect
0.1.50 FIX_COMMIT = d9453c9 fix(browser): preserve trailing observer recovery demand
0.1.50 RELEASE_COMMIT = 0662615 chore(release): version execution-browser-extension
0.1.50 background.ts sha256 = 857d7d5d5ff058571ac4723f53d6701483ad8dc3949f67c2b12972c7a09b49a7
0.1.50 background-observer-application.test.ts sha256 = 68ea90c93c0e892fb816fc8d680fa6c51be966d42b58de354b5d2cb62b0f4a4a
0.1.50 target code+test diff sha256 = c85f18f22e25c7502facb41a6e9483bfe4c287260687d8f74d5b72c445777a5b
Registry exact @tomflow/proflow-execution-browser-extension@0.1.50 = PASS / PRESENT
Product Workspace installed = 0.1.50
installed descriptor = 0.1.50
materialized marker = 0.1.50
materialized manifest = 0.1.50
background.js repo/node_modules/materialized sha256 = 691200cb74ac1c553e947bcf564be8fecbf7f0e705f0c0b62f2c5c2723319b0f / MATCH
Chrome registration path = current materialized loadDir / ENABLED
Chrome visible/runtime moduleVersion after sole Reload = 0.1.49
Extension ID = eehdadpmjffomabiedcjijiakconalab
verification.moduleVersion = 0.1.49
verification.extensionInstanceId = extension:4a03f111-954d-412a-bb5c-c4968105c965
verification.evidenceSource = PAIRING_HEARTBEAT
targeted setup = FAIL / EXTENSION_VERSION_MISMATCH
platform stop count = 1 / owner ABSENT
platform start after 0.1.50 adoption attempt = NOT_RUN / count=0
recovery adoption round 2 targeted setup = FAIL / PAIRING_TIMEOUT / count=1
recovery adoption round 2 semantic Reload = NOT_DISPATCHED / count=0
fresh privileged page = chrome://extensions/?errors=eehdadpmjffomabiedcjijiakconalab
fresh target card pre-attestation = FAIL / TARGET_NOT_VISIBLE_ON_CURRENT_ERROR_SUBPAGE
```

0.1.49 已完成 package → Registry → Workspace → materialized loadDir → Chrome registered Service Worker → browser-attested verification 的真实 adoption；不得再把版本采用问题重新当当前 blocker。

## FIXED_REAL3_TRUTH

```text
Task = task-a6f859c00b1accd027d53d48
Task status = ACTIVE
Task version = 10
currentNodeId = dev

Dev role = g-6a9717f68ef081918aacd5911916d2ec
Dev worker = 6a9b4632-ca8c-83e9-a4bc-9de9e229e515
Dev status = IN_PROGRESS
Dev runNo = 1

Test role = g-6a97186190108191bc24fb85b2cff584
Test role binding worker = 6a9b8ae0-f694-83e8-b4a2-0d20cbc5c04a
Test status = PENDING
Test runNo = 1

Product role/worker = g-6a97182669f88191a943e806a3e1b42a / 6a9b243c-7af8-83e9-a005-2ccfb8c5c8cb
```

正式 same-run resume 已完成，durable `TASK_RESUMED = task-event:10`。不得再次 ACK、resume 或 reopen。

原 durable wake 必须继续复用：

```text
executionRef = execution:e9b9c020-bfe2-4d85-8a17-e3c4a0b7a2c0
idempotencyKey = task-observer-wake:task-a6f859c00b1accd027d53d48:dev:1:TASK_RESUMED:task-event:10
status = FAILED
sideEffectState = NOT_APPLIED
attemptCount = 1
error = PRECONDITION_FAILED / WAKE_TRIGGER_TYPE_INVALID
```

0.1.49 runtime 复验前后 execution identity / idempotency / inputFingerprint / updatedAt 均未变化，没有 redecision。

## CURRENT_PROBLEM_CLASS

```text
original_class = REAL3_OBSERVER_RECOVERY_POST_RECONNECT
original_root_cause = PROVEN / OBSERVER_RECOVERY_SINGLE_FLIGHT_DROPS_REARM_EPOCH
0.1.50_release = PASS
0.1.50_workspace_materialization = PASS
current_class = REAL3_EXTENSIONS_PAGE_CANONICALIZATION_PRE_ATTESTATION
chrome_registration_path = MATCH / CURRENT_0.1.50_LOADDIR
chrome_runtime_version = 0.1.49 / FAIL_TO_ADOPT_0.1.50
platform_runtime_after_attempt = STOPPED / START_NOT_RUN
same_execution_redecision = NOT_RUN
browser_reload_harness_hardening = PASS / LOCAL_MECHANICAL_GATE
future_reload_semantic_attestation = READY / CARD_LOCAL_NAME_AND_ID + UNIQUE_PRESSABLE_RELOAD
recovery_adoption_round_2 = CONSUMED / STOPPED_BEFORE_RELOAD
recovery_adoption_round_2_first_divergence = FRESH_TARGET_CARD_PRE_ATTESTATION
extensions_page_canonicalization_root_cause = PROVEN / LOAD_UNPACKED_SHELL_PREDICATE_ACCEPTS_ERROR_SUBPAGE
previous_adoption_failure_root_cause = NOT_PROVEN
platform_start_admitted = NO
```

## CURRENT_FIRST_EVIDENCE

Codex 在 2026-09-07 只执行一次正式 `platform start`：`成功 4 / 跳过 19 / 失败 0`。启动前冻结 Browser Extension 日志 5041 行、Execution Runtime 日志 4292 行；启动后被动观察 20 秒，无人工 recovery/wake/browser mutation。

```text
BRIDGE_MODULE_VERSION = 0.1.49
BRIDGE_SESSION_ONLINE = YES
COMMAND_CONSUMER_READY = YES
Chrome ↔ 新 production bridge = ESTABLISHED
new execution.listSignals = NONE
new task.projection = NONE
new task.wake = NONE
REDECISION_EVENT = NONE
```

production bridge listener 属于本次新 `platform start` 进程，当前 Extension session 已在线，因此本次 start 后新 hello/reconnect epoch 已被现实证明发生。FIRST_DIVERGENCE 只冻结到：

```text
new production bridge hello/reconnect epoch = YES
→ expected Observer recovery activity
→ first visible Observer application completion event = NONE
```

2026-09-07 本 Chat 继续做 same-scene 只读诊断后，A 已可机械排除。当前 `behaviorAdapter.status` 对真实 Product Workspace 返回 `READY`；该 READY 同时要求 Chrome registration=ENABLED、running bridge `moduleVersion=0.1.49`、且 running `extensionInstanceId` 与 2026-09-07T07:14:58Z verification 记录完全一致。真实 0.1.49 bundle 在同一 SW startup 后执行 `startupReady()`，新 production bridge hello 成功后同步 `bridgeSessionEpoch += 1 → bridgeSessionEstablished(epoch)`；helper 对更大 epoch 且 `startupReady=true` 必同步调用 `recover()`。因此“hello/reconnect 成功但 rearm callback 未调用”与当前 authority 不相容。

同时只读 OS socket 现场确认：Chrome ↔ bridge `127.0.0.1:47080` 为 ESTABLISHED；Chrome ↔ Platform Host `127.0.0.1:51443` 当前无连接。因此 C 中“当前正卡在一个已经发出的 `/application/observer` HTTP fetch”子类不成立；若 C 仍成立，只能位于 application request 之前的 pre-host await。Diagnostic Extension reload 方案正式否决：reload 会重建 SW 并清空模块级 `observerRecoveryInFlight`，会销毁 B 所需的原现场证据。

## CURRENT_ROOT_CAUSE

2026-09-07 same-scene 只读证据已把 A/C 排除，B 升级为唯一 root cause：

```text
ROOT_CAUSE = PROVEN
ROOT_CAUSE_CLASS = OBSERVER_RECOVERY_SINGLE_FLIGHT_DROPS_REARM_EPOCH
FIRST_DIVERGENCE = runObserverRecovery() existing observerRecoveryInFlight branch
A = RULED_OUT
B = PROVEN
C = RULED_OUT
```

机械闭环：当前同一 0.1.49 SW 对 reconnect epoch 必同步调用 recover；`runBridgeLoop()` 每次 outer reconnect 都能完成 `chrome.storage.local.get("proflowRuntimeBridge")`；真实 0.1.49 options 页面又只读证明 `proflowTaskApplication` 特定 key 可成功回填 `http://127.0.0.1:51443`。`taskApplicationConfig()` 返回后到 `fetch(/application/observer)` 之间无其他 await，而 OS socket readback 同时证明 Chrome ↔ Platform Host `51443` 无活跃连接。因此 reconnect callback 未创建新的 recovery Promise；按当前源码唯一剩余控制流就是 `observerRecoveryInFlight` truthy → return existing Promise。新 bridge epoch 被 single-flight 吸收，当前 Promise settle 后也没有 trailing recovery 保证。

证据截图：`.proflow/tmp/real3-options-storage-probe.png`（只读 options page；无 token 回填、无写入）。Diagnostic Extension reload 仍禁止，因为会销毁原 in-flight 现场。

## RELEASE_ADOPTION_0.1.50_REALITY

2026-09-07 Codex 严格按冻结链执行到首次 Chrome adoption 后 STOP：release plan 唯一为 Browser Extension `0.1.49 → 0.1.50`；Registry exact 0.1.50 PRESENT；release/version commit `0662615`；Product Workspace installed / descriptor / materialization / manifest 全为 0.1.50；repo、node_modules、materialized `background.js` 三方 SHA-256 一致。正式 `platform stop` 仅一次且 owner=ABSENT；`platform update` 仅一次；targeted setup 仅一次；Chrome mutation 仅一次；`platform start` 未执行。固定 Task/Dev/Test 与 `execution:e9...` 未变化，也没有新 Task/Worker/Execution 或人工 recovery/wake。

Chrome actual adoption 未通过：唯一一次 `reload-at-point` 后 fresh screenshot 仍显示 `ProFlow Execution Browser 0.1.49`，同一 targeted setup 随后以 `EXTENSION_VERSION_MISMATCH` 失败，verification 仍为 0.1.49 / `extension:4a03f111-954d-412a-bb5c-c4968105c965`。网页总控随后只读调用正式 `probeChromeExtensionState()`，确认 Extension ID 的 registration `path` **精确等于当前 0.1.50 materialized loadDir** 且状态为 ENABLED；因此“Chrome 注册在旧目录”已排除。

新的 Browser harness 审计发现：canonical `reload-at-point` 当前只检查页面上存在目标 Extension 名称，然后无条件点击外部传入坐标、等待 750ms、截图并返回 `RELOADED_AT_FRESH_POINT`；它**没有机械证明该坐标属于目标 ID 的 Reload 控件，也没有在返回成功前证明目标 runtime/version 已变化**。因此该返回值只能证明一次 point-click 已执行，不能作为 target Extension reload attestation。当前 screenshot/targeted setup 已证明 0.1.50 runtime 没有被采用，但“点错控件 / 点中 Reload 后 Chrome 未采用 / 其它 privileged UI 分支”的精确子因仍未唯一证明。

```text
RELEASE_0.1.50 = PASS
REGISTRY_0.1.50 = PASS
WORKSPACE_0.1.50 = PASS
MATERIALIZATION_0.1.50 = PASS
REGISTRATION_PATH_MATCH = PASS
CHROME_ACTUAL_ADOPTION_0.1.50 = FAIL
RELOAD_AT_POINT_ACTION_COUNT = 1
RELOAD_TARGET_SEMANTIC_ATTESTATION = FAIL / NOT_PROVEN
TARGETED_SETUP_COUNT = 1
TARGETED_SETUP = FAIL / EXTENSION_VERSION_MISMATCH
PLATFORM_START_COUNT_AFTER_ADOPTION = 0
SAME_EXECUTION = UNCHANGED / REDECISION_NOT_RUN
ROOT_CAUSE_OF_CHROME_ADOPTION_FAILURE = NOT_PROVEN
```

## NEXT_ACTION

1. **停止真实 adoption 重试**：第二轮唯一 targeted setup 已消耗，semantic Reload 未 dispatch；当前不得再次 setup/Reload/start。
2. `ensureExtensionsPage()` 的 canonicalization root cause 已机械证明：它仅以全局 `Load unpacked` 按钮存在作为“已在 Extensions 主列表”的判据；`chrome://extensions/?errors=<id>` 仍属于同一 Extensions shell，因此会被错误接受并提前 return，导致 screenshot/geometry/reload 在错误子页执行。
3. 当前唯一下一门是 `EXTENSIONS_PAGE_CANONICALIZATION_HARDENING_ACCEPTANCE`：只允许本地修改 canonical Browser helper + deterministic tests，使所有依赖 Extension card 的 action 在执行前强制归一化到 exact `chrome://extensions` 主列表并机械证明 canonical page；真实 Browser mutation、setup/start 继续禁止。
4. canonicalization 本地机械门 PASS 后只允许提交 helper/tests/CURRENT 并 STOP；随后网页总控再单独冻结新的 ONE recovery adoption round。不得把 navigation fix 自动推导为新的 setup/Reload 授权。

## EXTENSIONS_PAGE_CANONICALIZATION_HARDENING_ACCEPTANCE

```text
ACCEPTANCE_FROZEN = YES
SCOPE = canonical browser-extension-ui helper + deterministic tests only
ROOT_CAUSE = PROVEN / LOAD_UNPACKED_SHELL_PREDICATE_ACCEPTS_ERROR_SUBPAGE
PRODUCT_EXTENSION_SOURCE_MUTATION = FORBIDDEN
PACKAGE_RELEASE_VERSION_MUTATION = FORBIDDEN
REAL_BROWSER_MUTATION = FORBIDDEN
TARGETED_SETUP = NOT_ADMITTED
CHROME_RELOAD = NOT_ADMITTED
PLATFORM_START = NOT_ADMITTED
PUSH_ADMITTED = NO
```

必须同时满足：

1. **Exact canonical page authority**：`ensureExtensionsPage()` 不得再把 `Load unpacked` 存在当作充分条件；必须机械区分 exact 主列表 `chrome://extensions`（允许尾 `/`）与 `chrome://extensions/?errors=...`、其它 query/hash/subroute。任何非 exact 主列表都必须视为 non-canonical。
2. **URL-first / fail-closed**：优先从当前前台 Chrome AX/address-bar authority 读取当前 URL；若无法取得足够 URL authority，不得仅靠 shell 按钮猜测 canonical page，必须 fail closed 或执行受控 canonical navigation 后再验证。
3. **Canonical navigation**：发现 error/detail/其它 extensions 子页时，只允许导航到 exact `chrome://extensions` 主列表；导航完成后必须重新读取当前 URL，并至少结合主列表 surface 证明已 canonicalized，才允许返回成功。
4. **No shell false-positive**：synthetic fixture 必须覆盖“error 子页也有 `Load unpacked`”场景，并证明旧 predicate 会误判、新逻辑必须强制 navigation/拒绝提前 return。
5. **All card-dependent actions share gate**：`status`、`screenshot-extensions`、`inspect-extension-geometry`、`reload-at-point`、install/uninstall 等依赖 Extensions card/list 的路径必须继续统一经过 hardened `ensureExtensionsPage()`；不得各自复制一套导航判断。
6. **No hidden mutation fallback**：禁止旧 screenshot 坐标、外部 X/Y、AppleScript JS、临时 helper；本批只修 page canonicalization，不执行任何真实 Reload/enable/disable/Remove/Load unpacked。
7. **Deterministic regression matrix** 至少覆盖：exact `chrome://extensions` PASS；exact trailing slash PASS；`?errors=<id>` NON_CANONICAL；任意 query NON_CANONICAL；hash/subroute NON_CANONICAL；非 extensions URL NON_CANONICAL；error 子页即使存在 `Load unpacked` 也不能 PASS；navigation 后 exact URL + list surface PASS；URL authority UNKNOWN 必须 fail closed。
8. **Mechanical gate**：targeted deterministic tests PASS、Swift compile-only PASS、scoped lint/format PASS、`git diff --check` PASS；0.1.50 产品 source hashes与四份 version facts必须不变。
9. 本批完成后允许一个本地 harness/navigation fix commit + CURRENT closeout；不得 push；不得自行启动新的 targeted setup/Reload round。

本 acceptance 只修复本轮 fresh pre-attestation 的 canonical-page root cause，不重新解释上一轮 0.1.50 adoption failure，也不证明 Chrome 已采用 0.1.50。

## BROWSER_RELOAD_HARNESS_HARDENING_ACCEPTANCE

```text
ACCEPTANCE_FROZEN = YES / LOCAL_HARNESS_BATCH_COMPLETED
SCOPE = canonical browser-extension-ui harness + harness tests only
PRODUCT_EXTENSION_SOURCE_MUTATION = FORBIDDEN
PACKAGE_VERSION_RELEASE_MUTATION = FORBIDDEN
REAL_BROWSER_MUTATION = FORBIDDEN / THIS_HARNESS_BATCH_ONLY
NEXT_REAL_MUTATION_AUTHORITY = ONE_RECOVERY_ADOPTION_ROUND_ACCEPTANCE
PLATFORM_START = NOT_ADMITTED
ROOT_CAUSE_OF_0.1.50_CHROME_ADOPTION_FAILURE = NOT_PROVEN
```

必须同时满足：

1. **Target identity must be card-local**：Reload 目标必须来自同一个最小 Extension card，该 card 内同时唯一包含 `ProFlow Execution Browser` 与 Extension ID `eehdadpmjffomabiedcjijiakconalab`；只匹配名称、全页存在名称、卡片顺序或历史坐标均不得作为 mutation authority。
2. **Reload control must be semantically bound**：优先从目标 card descendants 中解析 AX `Reload/重新加载` control；必须证明唯一。找不到、重复、AX role/action 不可按压时 fail closed。不得退化为“调用方传一个 X/Y 就点击”。
3. **Geometry guard**：若底层仍需 screen-point click，点击点只能由已证明的 target-card-owned Reload control bounds 派生，或在执行前机械证明 point ∈ Reload bounds；同时必须证明 point ∉ enable toggle / Remove / Details 等相邻 control bounds。任何 overlap/ambiguity 都 fail closed。
4. **Pre-mutation attestation**：真实 action 入口必须在点击前输出/冻结目标 Extension name、ID、card bounds、Reload bounds、derived click point 与唯一性结果；任何缺失不得执行 click。
5. **Action result semantics corrected**：helper 成功只能声明 `TARGET_RELOAD_CLICK_DISPATCHED`（或等价动作事实），不得用 `RELOADED` / `ADOPTED` 暗示 runtime 已更新。Chrome runtime/moduleVersion adoption 继续只由 pairing heartbeat、verification 与 Browser status 证明。
6. **No hidden fallback**：禁止旧 screenshot 坐标、`第几个扩展`、全页第一个 Reload、外部 env 坐标直接点击、AppleScript JS、临时 Swift/CG helper 旁路。若 canonical AX surface 无法唯一绑定，必须返回明确错误并 STOP。
7. **Mechanical regression matrix** 至少覆盖：正确 name+ID+唯一 Reload PASS；同名不同 ID FAIL；ID 不在同一卡片 FAIL；重复 Reload FAIL；Reload 缺失 FAIL；point 落在 toggle FAIL；point 落在 Remove/Details FAIL；point 超出 Reload bounds FAIL；唯一 target Reload 时 derived point PASS；成功结果不得包含 runtime/adoption assertion。
8. **Local gate only**：允许修改 `scripts/human-e2e/browser-extension-ui.swift`、必要的 `browser-extension-ui.mjs` 与新增/更新 harness tests；允许 compile-only / deterministic tests / static readback；禁止打开一次新的真实 mutation round，禁止 setup/Reload/start/update/publish/version。
9. harness mechanical gate 必须至少包含：targeted harness tests PASS、Swift compile-only PASS、`git diff --check` PASS、产品 Extension source hash 未变化、0.1.50 package-owned version facts 未变化。
10. 本批完成后只允许提交 harness fix + tests + CURRENT 机械结果，`git push` 仍禁止；随后立即 STOP 并交回网页总控冻结 **ONE recovery adoption round**。不得自行把 harness PASS 推导成第二次 Reload 授权。

验收目标不是证明上一轮到底“点错了”还是“点对但 Chrome 未采用”；上一轮 `ROOT_CAUSE_OF_0.1.50_CHROME_ADOPTION_FAILURE` 继续保持 `NOT_PROVEN`。本批只消除下一次 Browser mutation 的证据歧义，使未来一次 Reload 在点击前就具有可审计的目标语义。

## BROWSER_RELOAD_HARNESS_HARDENING_STATUS

```text
HARNESS_FIX_IMPLEMENTED = YES
TARGET_CARD_IDENTITY_BINDING = CARD_LOCAL_NAME_AND_EXACT_ID
TARGET_CARD_UNIQUE = REQUIRED / FAIL_CLOSED
RELOAD_CONTROL_CARD_LOCAL = YES
RELOAD_CONTROL_UNIQUE = REQUIRED / FAIL_CLOSED
RELOAD_CONTROL_PRESSABLE = ENABLED + AX_PRESS_REQUIRED
CLICK_POINT_SOURCE = VERIFIED_RELOAD_BOUNDS_MIDPOINT
CLICK_POINT_INSIDE_RELOAD = REQUIRED
CLICK_POINT_OVERLAP_OTHER_CONTROL = REJECTED
PRE_MUTATION_ATTESTATION = COMPLETE
ACTION_RESULT = TARGET_RELOAD_CLICK_DISPATCHED
DETERMINISTIC_MATRIX = PASS / 12_OF_12
TARGETED_NODE_TESTS = PASS / 2_OF_2
SWIFT_COMPILE_ONLY = PASS
SCOPED_BIOME = PASS
GIT_DIFF_CHECK = PASS
PRODUCT_EXTENSION_SOURCE_CHANGED = NO
PACKAGE_VERSION_CHANGED = NO / 0.1.50
REAL_BROWSER_MUTATION = NONE
ROOT_CAUSE_OF_PREVIOUS_ADOPTION_FAILURE = NOT_PROVEN
SECOND_RELOAD_SETUP_START_ADMITTED = NO
```

本批只消除了未来 Reload mutation 的 target/card/control/geometry 语义歧义；没有重新解释上一轮失败，也没有形成第二次 setup、Reload 或 platform start 授权。

## ONE_RECOVERY_ADOPTION_ROUND_ACCEPTANCE

```text
ACCEPTANCE_FROZEN = YES
ROUND = 0.1.50_CHROME_RECOVERY_ADOPTION_2
TARGET_VERSION = 0.1.50
TARGET_EXTENSION_ID = eehdadpmjffomabiedcjijiakconalab
HARNESS_FIX_COMMIT = 3d1eb52c72e03ea9c7ff4d48b584686827433156
TARGETED_SETUP_ADMITTED = YES / EXACTLY_ONE
CHROME_RELOAD_ADMITTED = YES / EXACTLY_ONE / CANONICAL_SEMANTIC_HELPER_ONLY
PLATFORM_UPDATE = FORBIDDEN
PACKAGE_RELEASE_VERSION_PUBLISH = FORBIDDEN
PLATFORM_STOP = NOT_NEEDED / OWNER_MUST_ALREADY_BE_ABSENT
PLATFORM_START = NOT_ADMITTED_IN_THIS_ROUND
TASK_EXECUTION_MUTATION = FORBIDDEN
PUSH_ADMITTED = NO
```

本 round 仅恢复 Chrome 对已物化 0.1.50 的 actual adoption；不重做 release/update，也不执行 production start。严格顺序如下：

1. **Preflight freeze**：HEAD 必须包含 `3d1eb52`，worktree clean；0.1.50 产品 source hash、四份 package-owned version facts、Registry/Workspace/materialization、三方 `background.js` hash 必须仍与 `CURRENT_AUTHORITY` 一致。start-owner 必须只读确认 `ABSENT`；若非 ABSENT，STOP，不再次 `platform stop`。
2. **SAME-SCENE baseline**：重新只读冻结固定 Task/Dev/Test、`execution:e9b9c020-bfe2-4d85-8a17-e3c4a0b7a2c0` identity/idempotency/inputFingerprint/updatedAt、Execution 总数、Browser/Execution 日志行数、Extension ID、旧 verification `0.1.49 / extension:4a03f111-...`。任一 durable identity 漂移立即 STOP。
3. **一次 targeted setup**：只允许一次 `platform setup --module execution-browser-extension --workspace /Users/agent/Desktop/proton-workspace`。必须先进入 pairing `WAITING_FOR_EXTENSION`，再允许 Browser action；setup 若在 Browser action 前就异常退出，STOP，不重跑。
4. **Fresh Browser pre-attestation**：使用 canonical helper 打开/观察当前 `chrome://extensions` 并获取 fresh reality；不得使用旧截图坐标。目标必须唯一绑定 `ProFlow Execution Browser` + exact Extension ID。
5. **一次 semantic Reload**：只允许一次 `node scripts/human-e2e/browser-extension-ui.mjs reload-at-point`，不得再传 `PROFLOW_BROWSER_RELOAD_X/Y`。helper 在 mutation 前必须输出 `TARGET_EXTENSION_NAME/ID`、card bounds、唯一 enabled AXPress Reload、Reload bounds、derived point、inside/overlap attestation；任一缺失或 fail-closed error 时视为 **reload count=0** 并 STOP，不得旁路点击。
6. helper 成功回执只接受 `TARGET_RELOAD_CLICK_DISPATCHED`，它只证明正确 target control 的 AXPress 已 dispatch；不得把该结果当作 runtime adoption PASS。
7. **唯一 adoption authority**：同一 setup 必须随后机械证明 Chrome runtime/moduleVersion=`0.1.50`、Extension ID 不变、产生新的 `extensionInstanceId`（必须不同于 `extension:4a03f111-954d-412a-bb5c-c4968105c965`）、pairing heartbeat PASS、`verification.moduleVersion=0.1.50`、verification instance=新实例、`evidenceSource=PAIRING_HEARTBEAT`、Browser status=READY。
8. 若 setup 返回 `EXTENSION_VERSION_MISMATCH`、PAIRING_TIMEOUT、旧 instance、旧 0.1.49、registration/path mismatch 或任何 UNKNOWN，则立即 STOP；**禁止第二次 setup、第二次 Reload、Remove/Load unpacked、enable/disable、update、rollback 或 start**。
9. 若 Chrome actual adoption 0.1.50 全部 PASS，本 round 仍立即 STOP。只读重新冻结 Task/Execution/log baseline 后交回网页总控；`platform start` 必须另行冻结 production-runtime acceptance，不能从本 round 继承。
10. 全程禁止 `TASK_OBSERVER_RECOVER`、`task.wake`、Execution retry、task.resume/ACK/reopen、新 Task/Worker/GPT/Execution、SQLite/direct durable mutation、git push。

### Immediate STOP

```text
PRECONDITION_DRIFT
START_OWNER_NOT_ABSENT
SETUP_NOT_WAITING
TARGET_IDENTITY_AMBIGUOUS
RELOAD_ATTESTATION_INCOMPLETE
RELOAD_HELPER_FAIL_CLOSED
SECOND_SETUP_REQUIRED
SECOND_RELOAD_REQUIRED
CHROME_RUNTIME_NOT_0.1.50
EXTENSION_ID_CHANGED
NEW_EXTENSION_INSTANCE_NOT_PROVEN
PAIRING_OR_VERIFICATION_FAIL
BROWSER_STATUS_NOT_READY
TASK_OR_EXECUTION_IDENTITY_DRIFT
ANY_PLATFORM_START_REQUEST
```

成功停止点只有：

```text
CHROME_ACTUAL_ADOPTION_0.1.50 = PASS
VERIFICATION_0.1.50 = PASS
BROWSER_READY = PASS
PLATFORM_START_COUNT = 0
SAME_EXECUTION = UNCHANGED
NEXT_GATE = PRODUCTION_RUNTIME_ONE_START_ACCEPTANCE
```

## ONE_RECOVERY_ADOPTION_ROUND_REALITY

2026-09-08 第二轮按冻结预检完成后只启动一次 targeted setup。setup 已进入“ProFlow 正在自动等待扩展连接”状态；随后 canonical `screenshot-extensions` 取得 fresh screenshot，但 helper 返回 `SCREENSHOT_MISSING`。图像与 `inspect-extension-geometry` 一致证明当前 privileged URL 为 `chrome://extensions/?errors=eehdadpmjffomabiedcjijiakconalab`，页面上是 Extension error detail，没有可供 card-local name+ID+Reload 绑定的目标卡片。

```text
ROUND_2_PREFLIGHT = PASS
TARGETED_SETUP_COUNT = 1
SETUP_WAITING_BEFORE_OBSERVATION = YES
FRESH_SCREENSHOT = PRESENT / ERROR_DETAIL_SUBPAGE
FRESH_EXTENSION_CARD_IDENTITY = NOT_PROVEN
TARGET_CARD_UNIQUE = NO / TARGET_CARD_NOT_VISIBLE
SEMANTIC_RELOAD_COMMAND_INVOKED = NO
CHROME_RELOAD_COUNT = 0
TARGETED_SETUP_RESULT = FAIL / PAIRING_TIMEOUT
CHROME_MODULE_VERSION = 0.1.49 / LAST_VERIFIED_PRE_ROUND
VERIFICATION_MODULE_VERSION = 0.1.49
VERIFICATION_INSTANCE_ID = extension:4a03f111-954d-412a-bb5c-c4968105c965
VERIFICATION_EVIDENCE_SOURCE = PAIRING_HEARTBEAT
BROWSER_STATUS = NOT_READY
PLATFORM_START_COUNT = 0
TASK_EXECUTION_IDENTITY = UNCHANGED
EXECUTION_COUNT = 5 / UNCHANGED
BROWSER_LOG_LINES = 5041 / UNCHANGED
EXECUTION_LOG_LINES = 4295 / UNCHANGED
ROOT_CAUSE_OF_PREVIOUS_ADOPTION_FAILURE = NOT_PROVEN
FIRST_DIVERGENCE = FRESH_TARGET_CARD_PRE_ATTESTATION
FINAL_STOP_POINT = RELOAD_NOT_DISPATCHED / ROUND_BUDGET_CONSUMED
```

`reload-at-point` 未被调用，所以本轮不存在 Reload action success/failure 的过度解读；也不能由本轮反推上一轮 adoption 失败的子因。任何对 `ensureExtensionsPage()` 的导航语义修复、新 setup/Reload round 或 production start 都需要新的独立 acceptance。

## TRAILING_RECOVERY_FIX_ACCEPTANCE

```text
ROOT_CAUSE = PROVEN
FIX_SCOPE = runObserverRecovery central coordinator
FIX_IMPLEMENTATION_ADMITTED_LOCAL = YES
LOCAL_FIX_RUNTIME_MUTATION = FORBIDDEN / SATISFIED
0.1.50_RELEASE_ADMITTED = YES / RELEASE_ADOPTION_0.1.50_ACCEPTANCE
```

必须同时满足：

1. **No concurrency**：任意时刻最多一个 recovery pass；已有 `observerRecoveryInFlight` 时不得新建并发 Promise。
2. **No lost demand**：in-flight 期间收到一个或多个 recovery request，只合并为一个 trailing demand；当前 pass settle 后必须恰好启动一个 trailing pass。
3. **Settle-before-trailing**：必须先清空当前 `observerRecoveryInFlight`，再启动 trailing pass；trailing 不得复用刚 settle 的旧 Promise。
4. **Suppression ownership preserved**：`nextRecoverySuppressions` 只在实际新 pass 开始时消费；被合并的 request 不得提前清空 suppression，也不得把旧 suppression 重复带入多个 pass。
5. **Retry timer stale guard**：bounded retry timer 必须绑定安排它的 recovery attempt；若 timer 触发前已有更新 attempt 启动，该旧 timer 必须 NOOP，防止 trailing/reconnect 后再多跑一轮。
6. **All entry points share coordinator semantics**：startupReady、bridge reconnect、content-triggered recovery、`TASK_OBSERVER_RECOVER`、task/approval continuation 后的 recovery、bounded retry 均不得绕开中央 single-flight/trailing 语义。
7. 不改变 Task/Execution idempotency、retry 上限、application operation 顺序、Browser side-effect、durable owner state；不得增加新的并发 recovery、Execution replay 或 direct durable mutation。
8. regressions 至少覆盖：single-flight 返回同一 in-flight Promise；多次 request 合并一个 trailing；trailing settle 后启动；stale retry NOOP；suppression 在实际 pass 才消费；REAL3-BRIDGE-REARM-01～04 不退化。

## TRAILING_RECOVERY_FIX_IMPLEMENTATION_STATUS

2026-09-07 本地 trailing-recovery fix 已实现并完成完整无真实 runtime mutation 的机械门：

```text
FIX_IMPLEMENTED_LOCAL = YES
TARGETED_REGRESSION = PASS / 23/23
EXTENSION_PACKAGE_TESTS = PASS / 178/178
EXTENSION_TYPECHECK = PASS
TEST_GOVERNANCE = PASS / testPlans=39 / formalCases=355 / executableTestFiles=161 / executableTestCalls=776 / crossDomainTraceCases=44 / noMapping=0 / errors=0
SURFACE_GOVERNANCE = PASS / packages=23 / exports=91 / binaries=14 / roleActions=32 / extensionMessages=9 / applicationOperations=11 / uiControls=12 / errors=0
NON_RUNTIME_TEMP_BUILD = PASS
BACKGROUND_SELF_CONTAINED = YES
PROVISIONING_IIFE_NO_ESM = YES
RUNTIME_CONTENT_IIFE_NO_ESM = YES
GIT_DIFF_CHECK = PASS
REPO_DIST_MUTATION = NONE
PRODUCT_WORKSPACE_MATERIALIZED = NO
CHROME_FIX_ADOPTION = NO
REAL_RUNTIME_FIX_READBACK = NOT_RUN
LOCAL_FIX_MECHANICAL_GATE = PASS
0.1.50_RELEASE_ADMITTED = YES / RELEASE_ADOPTION_0.1.50_ACCEPTANCE
```

实现保持中央 coordinator ownership：`observerRecoveryInFlight` truthy 时只设置 `observerRecoveryTrailingRequested=true` 并返回原 Promise；`finally` 先清空 in-flight，再消费一次 trailing demand；bounded retry 使用 `retryScheduledFromAttemptNo` 与当前 `observerRecoveryAttemptNo` 比较，使旧 attempt timer 在更新 pass 已启动后 NOOP。未修改 Task/Execution idempotency、application operation 顺序、retry 上限、rearm helper、durable owner state 或 Browser side-effect surface。

## RELEASE_ADOPTION_0.1.50_ACCEPTANCE

> 历史已执行 gate：release / Workspace / materialization 已 PASS；本 acceptance 在首次 Chrome mutation 后按 STOP 条件结束，**不得作为第二次 setup / Reload / start 的授权来源**。当前 authority 转到 `RELEASE_ADOPTION_0.1.50_REALITY` + `NEXT_ACTION`。

```text
ACCEPTANCE_FROZEN = YES / CONSUMED_AT_CHROME_ADOPTION_STOP
TARGET_PACKAGE = @tomflow/proflow-execution-browser-extension
FROM_VERSION = 0.1.49
TARGET_VERSION = 0.1.50
RELEASE_SET = EXACT_ONE_PACKAGE
LOCAL_FIX_MECHANICAL_GATE = PASS
0.1.50_RELEASE_ADMITTED = YES
0.1.50_ADOPTION_ADMITTED = YES / SEQUENTIAL_GATES_ONLY
PUSH_ADMITTED = NO
MANUAL_TASK_EXECUTION_MUTATION = FORBIDDEN
```

### A. Release candidate 与 source gate

1. 发布前 `background.ts`、对应 test 与 target diff 必须仍匹配 `CURRENT_AUTHORITY` 中冻结的 SHA-256；任何 source/test 漂移立即 STOP，重新机械验收，不得带新改动进入 0.1.50。
2. 当前 `.changeset/*.md` 中历史 intent 均已由 `.changeset/ledger.yaml` 记录消费；本轮新的唯一 Browser Extension `patch` intent 已固定为 `.changeset/observer-recovery-trailing-demand.md`。不得再新增第二条同目标 intent，也不得修改或重新激活 platform-cli 的已消费 intent。
3. source/fix commit gate 已满足：`FIX_COMMIT=d9453c9`，其中包含已验收 source/test/governance/CURRENT 与本轮唯一新 change intent。后续 release 前 source working tree 必须保持 clean；不得重复提交源码、不得 push。
4. `pnpm package:release --plan` / release plan 必须机械证明唯一 release set 为 `@tomflow/proflow-execution-browser-extension 0.1.49 → 0.1.50`。若出现其它 package、版本不是 0.1.50、plan UNKNOWN/挂起且无法由 ledger + version dry-run恢复权威，则 STOP。
5. Registry exact preflight `@tomflow/proflow-execution-browser-extension@0.1.50` 必须明确 `MISSING` 才允许首次 publish。若 `PRESENT`，禁止重复 publish并 STOP 核验 provenance；若网络/Registry 为 `UNKNOWN/ERROR`，不得按 MISSING 处理。

### B. Version / build / publish gate

1. 正式 version 必须由现有 release/version 机制产生；最终以下四个 package-owned version facts 必须全部等于 `0.1.50`：`package.json.version`、`proflow.module.json.moduleVersion`、`deployment/descriptor.ts.moduleVersion`、`manifest.json.version`。禁止手工只改其中一处。
2. version 后只允许 release tooling 预期的 Browser Extension version/changelog/ledger 变更；其它 package version 不得变化。冻结 release/version commit `RELEASE_COMMIT`，仍不得 push。
3. target `release-sync:check`、build 与 publishability 必须 PASS；若源码未变，不重复跑已通过的 178/178 全包测试来掩盖 release harness 问题。
4. publish 只允许目标 package `0.1.50`。publish 超时/UNKNOWN 后必须先 Registry exact readback；只有明确 `MISSING` 才可继续，`PRESENT` 直接视为 publish reality PASS，禁止 blind retry、`--force` 或同版本重发。
5. Registry exact readback 必须证明 `@tomflow/proflow-execution-browser-extension@0.1.50 = PRESENT` 后才能进入 Product Workspace。Registry publish 授权不包含 git push。

### C. Product Workspace adoption gate

进入任何真实 mutation 前先冻结：固定 Task/Dev/Test、原 `execution:e9b9c020-bfe2-4d85-8a17-e3c4a0b7a2c0` identity/idempotency/inputFingerprint/status、Browser/Execution 日志位置、当前 Extension ID/instance/version、Workspace 0.1.49 与 materialized 0.1.49 baseline。全程不得创建新 Task/Worker/GPT/Execution，不得 ACK/resume/reopen。

按以下顺序执行，禁止换序或重复：

1. **一次 `platform stop`**：因为 `platform update` 对 start-owner `RUNNING/UNVERIFIED` fail closed。stop 后 owner 必须权威回读为 `ABSENT`；`UNVERIFIED/TIMEOUT` 立即 STOP，禁止 update。
2. **一次定向 `platform update --package @tomflow/proflow-execution-browser-extension`**：Registry candidate 必须精确为 `0.1.50`。更新后 Workspace installed package/descriptor 必须为 0.1.50，且其它 ProFlow package version 不变。
3. update 的 Module.install 必须把 loadDir 重物化为 0.1.50。必须回读 `.proflow-materialization.json.moduleVersion=0.1.50`、materialized `manifest.json.version=0.1.50`；repo release build、Product Workspace `node_modules`、`.proflow/deployment` 三份 `dist/extension/background.js` 必须做 SHA-256 一致性证明。任一 mismatch STOP。
4. **一次 targeted `platform setup --module execution-browser-extension`**。必须先进入 pairing/`WAITING_FOR_EXTENSION`，再做 Browser mutation；禁止先 reload 后 setup。
5. 当前 0.1.49 registration 已知有效，因此本轮 Browser mutation 只准 **一次 Reload**。必须使用 canonical Chrome Extension helper + fresh screenshot，先确认 Extension ID `eehdadpmjffomabiedcjijiakconalab` 与目标 Reload 几何关系；目标不唯一、registration missing、需要 Remove/Load unpacked 时立即 STOP，不在同一 round 扩展动作。
6. Reload 后必须证明：Extension ID 不变；Chrome runtime manifest/moduleVersion=0.1.50；产生新的 `extensionInstanceId`；pairing heartbeat 成功；`verification.moduleVersion=0.1.50`、`verification.extensionInstanceId` 等于本轮新实例、`evidenceSource=PAIRING_HEARTBEAT`；targeted setup/Browser status = READY。
7. 完成 Chrome adoption 后再次冻结 Task/Execution 与 Browser/Execution 日志 baseline，然后才允许 **一次 `platform start`**。不得第二次 start、不得人工 reconnect/recover。

### D. Production reconnect / SAME-SCENE real readback

唯一一次 start 后只做被动 readback：

1. production bridge 必须证明 `moduleVersion=0.1.50 / sessionOnline=YES / commandConsumerReady=YES / extensionInstanceId=verification.extensionInstanceId`。
2. 新 production bridge epoch 必须出现 `BRIDGE_EPOCH_ACCEPTED → REARM_CALLBACK_ENTERED`。若命中旧 in-flight，允许出现 `REUSED_IN_FLIGHT`，但其 settle 后必须出现更新 attempt 的 `STARTED`；不得靠第二次 reconnect 触发。
3. 必须出现本轮新的 recovery application 进展，至少越过 `COLLABORATION_RECOVERY_BEGIN/SETTLED` 并产生新的 `execution.listSignals`/后续 Owner application readback。若只见 marker 不见后续 application，冻结新的 FIRST_DIVERGENCE 并 STOP。
4. 最终必须在**同一** `execution:e9b9c020-bfe2-4d85-8a17-e3c4a0b7a2c0` 上观察 durable redecision（预期 `EXECUTION_REDECISION_REQUESTED` / 同 idempotency identity），禁止产生替代 executionRef。
5. same-execution redecision PASS 后本 acceptance 立即 STOP，交回网页总控；Dev `file.read → complete → Test → SUCCEEDED` 属于后续 Real-3 final gate，不由 release/adoption executor继续越权推进。

### E. Failure / rollback policy

```text
AUTO_ROLLBACK = NO
ROLLBACK_ARTIFACT_AUTHORITY = Registry exact 0.1.49 + frozen pre-update hashes/evidence
PUBLIC_PLATFORM_DOWNGRADE = NOT_AVAILABLE
ROLLBACK_REQUIRES_SEPARATE_ADMISSION = YES
```

- 0.1.49 Registry package、pre-update Workspace/materialized hash、setup/verification identity 必须在 mutation 前冻结，作为 rollback authority。
- 若失败发生在 Chrome Reload **之前**：不得为了“恢复整齐”增加 Chrome mutation；保留 durable SAME-SCENE，记录当前 Workspace/adoption层次后 STOP。
- 若失败发生在 Chrome Reload **之后**：禁止盲 reload 第二次、禁止 repo copy、local tarball、直接改 node_modules 或手写 verification 回滚。当前公开 `platform update` 只取 Registry latest，不提供 downgrade；因此本轮不自动降级。
- 如确需恢复 0.1.49，必须另行准入一条 emergency rollback：只从 Registry exact `@tomflow/proflow-execution-browser-extension@0.1.49` 做 exact-version package-manager transaction（与 `updateWorkspacePackage` 的 `package@version` 语义一致）→ 正式 Module.install 重物化 → targeted setup → 一次 Browser adoption；未获该单独准入不得执行。

### F. Immediate STOP conditions

任一条件成立立即停止，不重复非幂等动作：source SHA 漂移；release set 非唯一；target version 非 0.1.50；Registry exact UNKNOWN；0.1.50 已存在但 provenance 未核清；publish reality UNKNOWN 且无法 Registry 回读；stop owner 非 ABSENT；update 改动其它 package；三份 artifact hash 不一致；Chrome target identity/Reload 几何不唯一；Extension ID 改变；setup/pairing timeout；需要第二次 Reload/Setup/Start；production bridge identity 与 verification 不一致；出现新 Task/Worker/Execution；same execution 被替代；需要人工 recovery/wake/resume/ACK/reopen；一次 start 后 Observer 仍无新的 application progress。

## DIAGNOSTIC_SEAM_ACCEPTANCE

> 历史诊断门：用于证明 A/B/C，不再是当前 release/adoption 权威。当前执行准入唯一以 `RELEASE_ADOPTION_0.1.50_ACCEPTANCE` 为准。

```text
DIAGNOSTIC_SEAM_ADMITTED = YES / HISTORICAL_COMPLETED
PRODUCT_BEHAVIOR_CHANGE = FORBIDDEN / DIAGNOSTIC_BATCH_ONLY
REAL_RUNTIME_MUTATION = NOT_PERFORMED_IN_DIAGNOSTIC_BATCH
0.1.50_RELEASE_ADMITTED = YES / CURRENT_ACCEPTANCE_OVERRIDES_HISTORICAL_GATE
```

必须同时满足：

1. bridge hello 接受后的每个新 session epoch 必须先 fire-and-forget 记录 `BRIDGE_EPOCH_ACCEPTED`，再调用 `bridgeSessionEstablished(epoch)`；callback 内必须再记录同 epoch 的 `REARM_CALLBACK_ENTERED`，且发生在 `runObserverRecovery()` 调用之前。这样前置 marker 存在而 callback marker 缺失时才可机械判 A。
2. `runObserverRecovery()` 必须可区分 `STARTED` 与 `REUSED_IN_FLIGHT`；reuse 分支不得创建新 Promise、不得改变原返回值。
3. 新 recovery 必须在 `collaborationCarrier.recoverPending(50)` 前后记录 `COLLABORATION_RECOVERY_BEGIN/SETTLED`；同时 `listPendingMessages()` 必须在首个 `invokeObserverApplication("collaboration.listPending")` await 前后记录 `COLLABORATION_LIST_PENDING_BEGIN/SETTLED`，其中 SETTLED 必须通过 `finally` 保留原异常传播。所有 marker 均不得被 await。
4. 所有新增诊断写入只能复用现有 `emitStructuredLog()`，必须 `void` fire-and-forget；不得新增业务 await、AbortSignal、timeout、retry、Task/Execution mutation、Browser action 或 durable idempotency state。
5. targeted regression 必须覆盖：rearm callback 顺序不变、single-flight reuse 返回同一 Promise、首个 recoverPending await 前后标记顺序、现有 REAL3-BRIDGE-REARM-01～04 不退化。
6. typecheck / package targeted tests / governance readback 全 PASS 后，只允许进入一次无真实 mutation 的诊断构建验收；真实 `platform start`、Chrome reload、recovery/wake 仍禁止。

机械判别：

```text
BRIDGE_EPOCH_ACCEPTED(epoch) present + no REARM_CALLBACK_ENTERED(epoch) => A
REARM_CALLBACK_ENTERED + REUSED_IN_FLIGHT => B
REARM_CALLBACK_ENTERED + STARTED + COLLABORATION_LIST_PENDING_BEGIN + no LIST_PENDING_SETTLED => C / FIRST_DIVERGENCE=collaboration.listPending await
COLLABORATION_LIST_PENDING_SETTLED present + no COLLABORATION_RECOVERY_SETTLED => C remains, but refreeze the deeper recoverPending substep before patching
COLLABORATION_RECOVERY_SETTLED present but execution.listSignals absent => A/B/C matrix invalid; refreeze FIRST_DIVERGENCE
```

## DIAGNOSTIC_SEAM_IMPLEMENTATION_STATUS

2026-09-07 本地诊断 seam 已实现并完成无真实 runtime mutation 的机械验收；尚未部署到真实 Product Workspace / Chrome。

```text
DIAGNOSTIC_SEAM_IMPLEMENTED_LOCAL = YES
TARGETED_REGRESSION = PASS / 19/19
EXTENSION_PACKAGE_TESTS = PASS / 174/174
EXTENSION_TYPECHECK = PASS
TEST_GOVERNANCE = PASS / errors=0
SURFACE_GOVERNANCE = PASS / errors=0
TEMP_DIAGNOSTIC_BUILD = PASS
PRODUCT_WORKSPACE_MATERIALIZED = NO
CHROME_DIAGNOSTIC_ADOPTION = NO
REAL_RUNTIME_DIAGNOSTIC_READBACK = NOT_RUN
CURRENT_ROOT_CAUSE = PROVEN / OBSERVER_RECOVERY_SINGLE_FLIGHT_DROPS_REARM_EPOCH
0.1.50_RELEASE_ADMITTED = YES / RELEASE_ADOPTION_0.1.50_ACCEPTANCE
```

本机 `pnpm --version` 当前会无输出挂起，因此本轮机械门直接复用仓库已安装的 Node 24.19.0、TypeScript、esbuild 与 governance scripts 执行；没有安装/升级依赖，也没有把 package-manager 异常误判为产品失败。

当前本地 trailing-recovery mechanical gate 已 PASS，且 **0.1.50 release/adoption acceptance 已冻结并有限准入**。诊断 adoption 永久取消；后续只允许严格按 `RELEASE_ADOPTION_0.1.50_ACCEPTANCE` 的 sequential gates 执行，任何未列明或需要重复的真实 mutation 一律 STOP。

## EXECUTION_SPLIT

```text
网页总控 Chat = Reality / authority / FIRST_DIVERGENCE / patch admission / SAME-SCENE final acceptance
Codex = 已冻结任务的源码分析、实现、tests/typecheck/build/governance/release、机械 runtime evidence collection
```

给 Codex 只提供 repo path、checkpoint、允许范围、验收条件和 STOP POINT；不要求它使用 CodeGraph / Repomix / Local Dev MCP。

## PATCH_TRAIN_GUARD

最近 50 个 commit：release 类 19（38%）、fix 17（34%）、docs 9（18%）；execution-browser-extension 触碰 28/50；四天内 Extension 从 0.1.37 连续到 0.1.49。Real-3 已事实性漂移成 Integration Hardening，因此冻结：

```text
0.1.49 = PREVIOUS_RC / REALITY_FAIL
0.1.50 = RELEASE_PASS / WORKSPACE_PASS / MATERIALIZATION_PASS / CHROME_ACTUAL_ADOPTION_FAIL
Final Real Gate != Integration Hardening
```

不阻塞 `Observer → same execution → Dev → Test → SUCCEEDED` 的问题全部 backlog。

## DO_NOT_REPEAT

- 不重开 0.1.45～0.1.48 Browser adoption、Tunnel、TASK_RESUMED allowlist 等已闭环问题。
- `RELEASE_ADOPTION_0.1.50_ACCEPTANCE` 的旧 stop/update/setup/Reload 配额均已消费；不得把旧 acceptance 当作当前 mutation authority。
- 本次真实 Browser mutation authority 曾为 `ONE_RECOVERY_ADOPTION_ROUND_ACCEPTANCE`；该 authority 已消耗，当前没有新的 Browser mutation authority。
- `ONE_RECOVERY_ADOPTION_ROUND_ACCEPTANCE` 已在 fresh target-card pre-attestation 失败处消耗：targeted setup=1，Reload=0，setup 最终 `PAIRING_TIMEOUT`。不得把未使用的 Reload 配额带入另一次 setup，也不得在本 round 重试。
- semantic Reload 必须由 `3d1eb52` canonical helper 直接解析 card-local name+ID、唯一 enabled AXPress Reload 并输出完整 pre-mutation attestation；外部 X/Y、旧截图坐标、旁路 helper 全部禁止。
- 当前新增的 `EXTENSIONS_PAGE_CANONICALIZATION_HARDENING_ACCEPTANCE` 仅授权本地 helper/test 修复；不得借此执行 setup/Reload/start。`Load unpacked` 单独存在不再允许作为 Extensions 主列表 authority。
- 不人工发 `TASK_OBSERVER_RECOVER`、`task.wake`、Execution retry。
- 不再次 task.resume / ACK / reopen；不新建 Task、Worker、GPT、Execution。
- 不直接写 SQLite、roles registry、verification、node_modules 或 durable Owner state。
- 不因为发现真实 defect 就立即 release；`VALID_DEFECT != CURRENT_ROOT_CAUSE`。
- 0.1.50 release/Workspace/materialization 已完成；本 recovery adoption round 不得重新 version/publish/update/rollback。Chrome adoption PASS 后仍必须 STOP，platform start 另行准入。
- 不 push；npm Registry publish 与 git push 仍是独立授权边界。

## REQUIRED_CONTEXT

1. `03-自动化知识库/基础动作/Chat-高吞吐本地工程执行.md`
2. `03-自动化知识库/基础动作/Browser-UI自动化.md`
3. `03-自动化知识库/基础动作/Round-PID-Log与恢复.md`
4. `03-自动化知识库/流程/Real3-J0-J4.md`
5. `90-历史记录/Real3/24-Real3执行效率与证据链教训-20260907.md`
6. `90-历史记录/Real3/25-Real3-0.1.49真实复验失败与当前Chat交接-20260907.md`

## STOP_POINT

`0.1.49_REALITY_FAIL / ROOT_CAUSE_PROVEN_SINGLE_FLIGHT_DROPS_REARM_EPOCH / FIX_COMMIT_d9453c9 / 0.1.50_RELEASE_COMMIT_0662615 / REGISTRY_0.1.50_PASS / WORKSPACE_0.1.50_PASS / MATERIALIZATION_0.1.50_PASS / REGISTRATION_PATH_MATCH_PASS / FIRST_ADOPTION_SETUP_FAIL_EXTENSION_VERSION_MISMATCH / FIRST_RELOAD_COUNT_1 / CHROME_RUNTIME_STILL_0.1.49 / VERIFICATION_STILL_0.1.49 / PLATFORM_START_COUNT_0 / SAME_EXECUTION_UNCHANGED / PREVIOUS_ADOPTION_ROOT_CAUSE_NOT_PROVEN / HARNESS_FIX_COMMIT_3d1eb52 / BROWSER_RELOAD_HARNESS_HARDENING_PASS / ROUND2_PREFLIGHT_PASS / ROUND2_TARGETED_SETUP_COUNT_1 / ROUND2_SETUP_WAITING_PASS / ROUND2_FRESH_PRIVILEGED_PAGE_ERROR_SUBPAGE / ROUND2_TARGET_CARD_PRE_ATTESTATION_FAIL / ROUND2_RELOAD_COUNT_0 / ROUND2_SETUP_FAIL_PAIRING_TIMEOUT / ROUND2_BUDGET_CONSUMED / EXTENSIONS_PAGE_CANONICALIZATION_ROOT_CAUSE_PROVEN_LOAD_UNPACKED_SHELL_FALSE_POSITIVE / EXTENSIONS_PAGE_CANONICALIZATION_HARDENING_ACCEPTANCE_FROZEN / LOCAL_HELPER_TEST_FIX_ONLY / REAL_BROWSER_MUTATION_FORBIDDEN / TARGETED_SETUP_NOT_ADMITTED / CHROME_RELOAD_NOT_ADMITTED / PLATFORM_START_NOT_ADMITTED / NEXT_EXECUTION_CANONICALIZATION_FIX_AND_MECHANICAL_GATE / MANUAL_TASK_EXECUTION_MUTATION_FORBIDDEN / PUSH_FORBIDDEN / J4_PAUSED_FOR_INTEGRATION_HARDENING`。
