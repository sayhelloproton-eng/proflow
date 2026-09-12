---
"@tomflow/proflow-execution-browser-extension": patch
"@tomflow/proflow-agent-controller-dev": patch
"@tomflow/proflow-agent-test-ops": patch
---

Make all shipped Custom GPT Actions nonconsequential at the Carrier layer, keep ProFlow effect authorization in Role/Host/Extension/provider policy, and harden ChatGPT Permission observation with text hydration, a 10-second bottom-of-page watchdog, and stale content-session recovery.
