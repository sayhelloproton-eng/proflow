# @tomflow/proflow-execution-runtime — Module Setup

## Goal
Reach `setupStatus=READY` with zero user configuration.

## Step 1 — Resolve producer-owned runtime facts
**Type:** automatic
**Executable:** `platform setup --module execution-runtime --workspace <workspace>`
The Module consumes Platform Host, Model Runtime and Browser Executor shared facts. No database path, endpoint, token or artifact path is user input.

## Step 2 — Verify completion
**Type:** automatic verification
**Executable:** `platform status --workspace <workspace>`
**Success condition:** `execution-runtime.setupStatus=READY`. If a producer is not ready, the full `platform setup` result must expose that producer's own setup action or machine failure.
