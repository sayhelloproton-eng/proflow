# @tomflow/proflow-platform-host — Module Setup

## Goal

Reach `setupStatus=READY` without user configuration.

## Step 1 — Complete machine-owned preparation

**Type:** automatic
**Executable:** `platform install`
**What happens:** No user input is required. Local endpoints, stateRoot and credential files are deterministic. Execution/Model facts must come from producer-owned shared facts; if absent this Module reports FAILED rather than asking the user to copy them.

## Step 2 — Re-observe dependency and setup state

**Type:** automatic verification
**Verify:** `platform status`
**Success condition:** `platform-host.setupStatus=READY`.

There is no human setup action. A missing machine-owned artifact or producer-owned dependency is a `FAILED` condition to fix in the owning package/dependency; it must never be converted into a request for path/token/endpoint input.
