---
"@tomflow/proflow-devtunnel-cli": patch
"@tomflow/proflow-execution-browser-extension": patch
"@tomflow/proflow-model-provider-api": patch
---

Close the final Deployment replay defects: make Dev Tunnel CLI version probing tolerate real service latency, keep Browser Extension setup idempotent across retries, and remember a non-sensitive Provider endpoint across temporary outages without fabricating readiness.
