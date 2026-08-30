---
"@tomflow/proflow-agent-runtime": patch
"@tomflow/proflow-platform-cli": patch
---

Close the Fresh deployment deadlock between Custom GPT provisioning and Gateway runtime startup: materialize the Agent Runtime owned durable Role credential store during deployment setup, and temporarily bootstrap only the required service dependency closure while agent-package setup performs real Gateway health and authenticated Action verification.
