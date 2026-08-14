# @tomflow/proflow-model-runtime

- Module: `model-runtime`
- Kind: `service`
- Owner: Model & Reasoning

Implements strict FAST/REASON/AUTO routing, a single priority lane, bounded timeouts and repair, capability verification, an OpenAI-compatible provider boundary, and the frozen `infer`/`getRuntimeStatus` service API. The module returns data only and cannot execute capabilities or real-world Effects.

## Task Diagnostic / System Assessment workload

`model-runtime` also serves bounded Task diagnostic and System Observer reasoning requests through the same typed inference boundary. Normal Task progression is deterministic and does not call the model. System assessment is background/lowest-priority work; batching, carry-forward, drill-down and global-synthesis orchestration remain caller/application responsibilities. The runtime owns no System Observer store, Task state, or business action authority, and model unavailability must never block the Task mainline.
