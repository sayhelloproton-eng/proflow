---
"@tomflow/proflow-platform-cli": patch
---

Carry persisted workspace configuration into Registry-backed upgrade planning, with explicit --config values overlaying stored values, so newly published descriptors cannot falsely report existing required configuration as missing before package mutation.
