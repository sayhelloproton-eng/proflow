---
"@tomflow/proflow-chatgpt-carrier": patch
---

Treat protected HTTP 401/403 carrier responses as reachable only when the same carrier URL has healthy verified Web-carrier evidence, while keeping missing/server/network failures fail-closed.
