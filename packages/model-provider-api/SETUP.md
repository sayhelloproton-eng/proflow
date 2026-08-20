# @tomflow/proflow-model-provider-api — Module Setup

## Goal
Reach `setupStatus=READY` by selecting the real OpenAI-compatible provider endpoint; never expose Module-private paths or copy provider facts through Platform config.

## Step 1 — Configure the provider endpoint
**Type:** human/external choice
**Human action:** Choose the provider API base URL. Provide a credential reference only when the provider requires authentication.
**Verify/commit executable:** `platform setup --module model-provider-api --workspace <workspace> --input '{"providerBaseUrl":"<base-url>"}'`
The Module probes the real `/models` endpoint before declaring READY.

## Step 2 — Verify completion
**Type:** automatic verification
**Executable:** `platform status --workspace <workspace>`
**Success condition:** `model-provider-api.setupStatus=READY`. If a credential is required but no producer-owned credential resolver contract exists, the Module returns machine `FAILED`; do not ask the user to paste internal credential files or bypass the contract.
