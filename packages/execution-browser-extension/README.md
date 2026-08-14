# @tomflow/proflow-execution-browser-extension

Execution-owned MV3 Browser executor/evidence provider plus the v1 Extension application surface: Task UI/New Task, Approval/Alert UI, deterministic Task Observer, low-priority System Observer, and Background Carrier Controller. These application blocks consume owner facts only through public ports and do **not** become Task/Agent/Collaboration business owners.

The Carrier uses stable `workerRef/conversationLocator` and transient tab/content identities; v1 has no frame registry, frame-role handshake, iframe team workspace, persistent-tab business identity, per-Action Browser scheduler, or ordinary Browser file manager. DOM/programmatic input is primary; screenshot→Vision is fallback. Real Browser writes reuse durable Execution semantics and UNKNOWN is never blindly replayed.

The optional `./bridge` export provides the loopback-only, token-authenticated runtime transport selected by real MV3 integration. It binds only `127.0.0.1`; the extension performs an explicit session hello, fresh polling heartbeat, typed command delivery, and result reporting. The bridge is never a public ingress or a second business truth.
