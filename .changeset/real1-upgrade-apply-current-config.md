---
"@tomflow/proflow-platform-cli": patch
---

Rebuild upgrade apply staleness from the current persisted Workspace configuration so unchanged config remains fresh while configuration drift becomes PLAN_STALE instead of being misreported as missing required config.
