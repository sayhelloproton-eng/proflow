# @tomflow/proflow-execution-browser-extension — Module Setup

## Goal
Reach `setupStatus=READY` by loading the already-materialized MV3 extension; bridge endpoints/tokens/runtime config are automatic.

## Step 1 — Ask the Module for the load directory
**Type:** automatic preparation
**Executable:** `platform setup --module execution-browser-extension --workspace <workspace>`
The returned action identifies the unpacked extension directory materialized by `Module.install`.

## Step 2 — Load the unpacked extension
**Type:** human Chrome action
**Human action:** Load that directory in `chrome://extensions`, then copy the canonical 32-character extension ID.
**Verify/commit executable:** `platform setup --module execution-browser-extension --workspace <workspace> --input '{"extensionId":"<32-char-id>"}'`
The Module then writes runtime configuration from producer-owned shared facts.

## Step 3 — Reload and verify the MV3 service worker
**Type:** human observation + Module evidence
**Human action:** Reload the extension and confirm its service worker is RUNNING.
**Verify/commit executable:** `platform setup --module execution-browser-extension --workspace <workspace> --input '{"serviceWorker":"RUNNING"}'`

## Step 4 — Verify completion
**Type:** automatic verification
**Executable:** `platform status --workspace <workspace>`
**Success condition:** `execution-browser-extension.setupStatus=READY`.
