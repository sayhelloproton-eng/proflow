# @tomflow/proflow-execution-browser-extension — Module Setup

After Module.install materializes the deployment directory and deterministic local configuration, load the unpacked extension in Chrome when requested. Confirm the real extension Service Worker is running, then rerun Module.setup so it can re-observe Chrome reality and record evidence. Endpoints, tokens and evidence paths are not user configuration.

## Completion

Setup is complete only when the Module's own `status` reports `setupStatus=READY`. Re-running setup must re-observe reality; it must not resume from a blind historical step index.
