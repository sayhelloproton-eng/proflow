# @tomflow/proflow-module-template — Module Setup

## Goal

Reach `setupStatus=READY` with zero user configuration.

## Step 1 — Materialize deterministic state

**Type:** automatic
**Executable:** `platform install`
**What happens:** `Module.install` completes all deterministic preparation owned by this Module. No private path, token, endpoint or cross-Module fact is requested from the user.

## Step 2 — Verify completion

**Type:** automatic verification
**Executable:** `platform status`
**Success condition:** `module-template.setupStatus=READY`.

There are no human or external setup steps. Re-running setup/status must re-observe current reality rather than depend on a historical step index.
