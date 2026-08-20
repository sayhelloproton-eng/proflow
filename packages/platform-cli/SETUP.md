# @tomflow/proflow-platform-cli — Module Setup

The Platform CLI owns orchestration only. It never interprets another Module's setup details. Global `platform setup` traverses every discovered Module, skips `READY` Modules, lets each non-ready Module run its own package-owned setup workflow, and aggregates every remaining `ACTION_REQUIRED` or `FAILED` result in one response.

## Step 1 — Verify the Platform CLI Module

**Executable**

```bash
platform setup --module platform-cli
```

**Success condition**

`platform status` reports `platform-cli setup=READY`. No user/private path, token, loopback endpoint, or cross-Module fact is requested.

## Step 2 — Run the full workspace setup guide

**Executable**

```bash
platform setup
```

**Success condition**

All automatically solvable Module setup work is completed in the same run, and every remaining human/external action is listed together. Re-running the command re-observes reality and continues until all required Modules report `setupStatus=READY`.
