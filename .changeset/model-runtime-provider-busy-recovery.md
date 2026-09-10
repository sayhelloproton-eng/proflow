---
"@tomflow/proflow-model-runtime": patch
---

Retry transient HTTP 409 provider-busy responses during bounded capability probing so a failed inventory candidate cannot poison subsequent FAST/THINK discovery on single-concurrency providers.
