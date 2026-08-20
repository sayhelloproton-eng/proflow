# @tomflow/proflow-task-migration-runner — Module Setup

## Goal

Reach `setupStatus=READY` without user configuration.

## Step 1 — Complete machine-owned preparation

**Type:** automatic
**Executable:** `platform install`
**What happens:** No user input is required. Required schema migrations are machine-owned and must run automatically.

## Step 2 — Re-observe dependency and setup state

**Type:** automatic verification
**Verify:** `platform status`
**Success condition:** `task-migration-runner.setupStatus=READY`.

There is no human setup action. A missing machine-owned artifact or producer-owned dependency is a `FAILED` condition to fix in the owning package/dependency; it must never be converted into a request for path/token/endpoint input.
