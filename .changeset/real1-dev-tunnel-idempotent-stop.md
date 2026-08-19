---
"@tomflow/proflow-dev-tunnel": patch
---

Make managed dev-tunnel stop idempotent when no owned tunnel process remains, while preserving UNKNOWN for genuinely ambiguous stop failures.
