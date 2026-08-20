# @tomflow/proflow-model-runtime — Module Setup

## Goal
Reach `setupStatus=READY` after the user selects only the FAST and REASON model identifiers. Provider endpoint/credential and capability facts must come from producer-owned contracts or Module-owned probes.

## Step 1 — Select FAST and REASON models
**Type:** human product choice
**Human action:** Choose the provider model IDs for the FAST and REASON roles.
**Verify/commit executable:** `platform setup --module model-runtime --workspace <workspace> --input '{"fastModel":"<fast-model-id>","reasonModel":"<reason-model-id>"}'`
Do not provide `capabilityProfilesFile`, token paths, provider URLs or other system-owned facts.

## Step 2 — Verify completion
**Type:** automatic verification
**Executable:** `platform status --workspace <workspace>`
**Success condition:** `model-runtime.setupStatus=READY` after provider-owned capability profile/facts are available and validated. If that producer contract is absent, the Module returns machine `FAILED`; this is not a user configuration action.
