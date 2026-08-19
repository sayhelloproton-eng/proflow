---
"@tomflow/proflow-chrome-runtime": patch
---

Increase the bounded Chrome version probe timeout so slow but healthy macOS Chrome cold starts do not produce false ACTION_REQUIRED status or manifest readiness failures.