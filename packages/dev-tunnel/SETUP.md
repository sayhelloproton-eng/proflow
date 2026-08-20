# @tomflow/proflow-dev-tunnel — Module Setup

## Goal
Reach `setupStatus=READY` with one Microsoft Dev Tunnel login and one persistent tunnel selection; public URL/state remain Module-owned shared facts.

## Step 1 — Complete Microsoft Dev Tunnel login
**Type:** human/external
**Executable:** `platform setup --module dev-tunnel --workspace <workspace>`
If login is required, complete the Microsoft Dev Tunnel authentication requested by the Module, then rerun the same command.

## Step 2 — Create or select the persistent tunnel
**Type:** human/external
**Human action:** Create/select the tunnel and obtain its `tunnelId` and HTTPS public base URL.
**Verify/commit executable:** `platform setup --module dev-tunnel --workspace <workspace> --input '{"tunnelId":"<id>","publicBaseUrl":"https://<host>"}'`

## Step 3 — Verify completion
**Type:** automatic verification
**Executable:** `platform status --workspace <workspace>`
**Success condition:** `dev-tunnel.setupStatus=READY`. Other Modules consume the resulting public URL through shared facts; the user does not copy it into their configs.
