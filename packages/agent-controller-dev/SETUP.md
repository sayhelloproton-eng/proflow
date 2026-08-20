# @tomflow/proflow-agent-controller-dev — Module Setup

## Goal
Reach `setupStatus=READY` with one unavoidable human action: create/select the real Controller/Development Custom GPT.

## Step 1 — Prepare the Custom GPT bundle
**Type:** automatic
**Executable:** `proflow-agent-controller-dev custom-gpt setup --workspace <workspace>`
This prints the package-owned Instructions, knowledge files, capabilities and Action schema using the Gateway URL discovered from Workspace shared facts. Do not copy internal endpoints or token paths manually.

## Step 2 — Create or update the Custom GPT
**Type:** human
**Human action:** Apply the prepared bundle in ChatGPT Web and obtain the real `https://chatgpt.com/g/g-...` URL.
**Verify/commit executable:** `proflow-agent-controller-dev role register <gpt-url> --workspace <workspace>`
This uses Agent Runtime's durable role API directly; Platform Host does not need to be running.

## Step 3 — Re-observe completion
**Type:** automatic verification
**Executable:** `platform setup --module agent-controller-dev --workspace <workspace>`
**Success condition:** `platform status --workspace <workspace>` reports `agent-controller-dev.setupStatus=READY`.
