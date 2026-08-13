# @tomflow/proflow-execution-browser-extension

Execution-owned MV3 Browser executor, carrier coordinator, evidence provider, and read-only Side Panel. Task, Agent, and Execution owner facts are consumed only through their public ports.

The optional `./bridge` export provides the loopback-only, token-authenticated runtime transport selected by real MV3 integration. It binds only `127.0.0.1`; the extension performs an explicit session hello, fresh polling heartbeat, typed command delivery, and result reporting. The bridge is never a public ingress or a second business truth.
