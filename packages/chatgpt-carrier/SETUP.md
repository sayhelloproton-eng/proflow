# @tomflow/proflow-chatgpt-carrier — Module Setup

## Goal
Reach `setupStatus=READY` using only real ChatGPT Web facts; evidence paths and internal credentials remain Module-owned.

## Step 1 — Create or select the real Custom GPT
**Type:** human
**Human action:** Create/select the Custom GPT and obtain its real `https://chatgpt.com/g/g-...` URL.
**Verify/commit executable:** `platform setup --module chatgpt-carrier --workspace <workspace> --input '{"carrierUrl":"<gpt-url>"}'`

## Step 2 — Verify the carrier once
**Type:** human verification + Module persistence
**Human action:** Confirm the real GPT is reachable and that Actions, OpenAPI, auth and any required File Bridge / Code Interpreter / Web Search / Apps settings match the package guidance.
**Executable:** `platform setup --module chatgpt-carrier --workspace <workspace> --input '{"carrierUrl":"<gpt-url>","verification":{"reachable":"VERIFIED","actionsEnabled":"VERIFIED","openApiInstalled":"VERIFIED","actionAuthValid":"VERIFIED","fileBridge":"VERIFIED","codeInterpreter":"NOT_REQUIRED","webSearch":"NOT_REQUIRED","appsDisabledWhenRequired":"VERIFIED"}}'`
Use `VERIFIED`, `UNVERIFIED`, `FAILED` or `NOT_REQUIRED` according to the real carrier; do not mark an unobserved capability VERIFIED.

## Step 3 — Re-observe completion
**Type:** automatic verification
**Executable:** `platform status --workspace <workspace>`
**Success condition:** `chatgpt-carrier.setupStatus=READY` and the real carrier is available.
