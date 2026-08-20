# @tomflow/proflow-agent-gateway — Module Setup

## Goal
Reach `setupStatus=READY` with zero user configuration.

## Step 1 — Resolve producer-owned dependencies
**Type:** automatic
**Executable:** `platform setup --module agent-gateway --workspace <workspace>`
The Module reads the Dev Tunnel public URL and Platform Host endpoint/credentials from producer-owned shared facts. No path, token, endpoint or credential is copied by the user.

## Step 2 — Verify completion
**Type:** automatic verification
**Executable:** `platform status --workspace <workspace>`
**Success condition:** `agent-gateway.setupStatus=READY`. If a producer is not READY, the full `platform setup` output must expose that producer's own setup action instead of asking the user to configure Agent Gateway internals.
