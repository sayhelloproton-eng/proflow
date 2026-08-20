# @tomflow/proflow-agent-runtime — Module Setup

## Goal

Reach `setupStatus=READY` without user configuration.

## Step 1 — Complete machine-owned preparation

**Type:** automatic
**Executable:** `platform install`
**What happens:** No user input is required. Agent durable state is internal and is materialized/used by owning runtime paths.

## Step 2 — Re-observe dependency and setup state

**Type:** automatic verification
**Verify:** `platform status`
**Success condition:** `agent-runtime.setupStatus=READY`.

There is no human setup action. A missing machine-owned artifact or producer-owned dependency is a `FAILED` condition to fix in the owning package/dependency; it must never be converted into a request for path/token/endpoint input.
