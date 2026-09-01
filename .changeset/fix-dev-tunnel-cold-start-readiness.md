---
"@tomflow/proflow-dev-tunnel": patch
---

Keep dev-tunnel runtime readiness within its ownership boundary by requiring HTTPS/TLS transport readiness without waiting for the downstream Gateway HTTP service during cold start.
