# @tomflow/proflow-task-store-sqlite — Module Setup

## Goal

Reach `setupStatus=READY` without user configuration.

## Step 1 — Complete machine-owned preparation

**Type:** automatic
**Executable:** `platform install`
**What happens:** No user input is required. Database paths are deterministic; schema materialization is completed by the owning migration package in dependency order.

## Step 2 — Re-observe dependency and setup state

**Type:** automatic verification
**Verify:** `platform status`
**Success condition:** `task-store-sqlite.setupStatus=READY`.

There is no human setup action. A missing machine-owned artifact or producer-owned dependency is a `FAILED` condition to fix in the owning package/dependency; it must never be converted into a request for path/token/endpoint input.
