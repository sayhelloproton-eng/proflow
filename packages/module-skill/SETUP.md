# @tomflow/proflow-module-skill — Module Setup

## Goal

Reach `setupStatus=READY` with zero user configuration.

## Step 1 — Materialize deterministic state

**Type:** automatic
**Executable:** `platform install`
**What happens:** Module governance skill package; deterministic package materialization only. The user is never asked for private paths, loopback endpoints, token files, artifact paths or producer-owned shared facts.

## Step 2 — Re-observe setup state

**Type:** automatic verification
**Verify:** `platform status`
**Success condition:** `module-skill.setupStatus=READY`.

No human or external setup action is required. If a machine-owned dependency is unavailable, the Module must report `FAILED` rather than converting it into user configuration.
