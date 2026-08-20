# @tomflow/proflow-deployment-conformance — Module Setup

## Goal

Reach `setupStatus=READY` without user configuration.

## Step 1 — Materialize deterministic state

**Type:** automatic
**Executable:** `platform install`
**What happens:** the Module install seam completes deterministic preparation; no private path, endpoint, token or shared fact is requested from the user.

## Step 2 — Verify completion

**Type:** automatic verification
**Verify:** `platform status`
**Success condition:** `deployment-conformance.setupStatus=READY`.

No human or external setup action is required.
