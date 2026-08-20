# @tomflow/proflow-agent-product — Module Setup

This Agent Package requires real Custom GPT / role setup. Use the package-owned role/custom-gpt capabilities to prepare the product role, complete any ChatGPT Builder / Action / authentication steps, then rerun Module.setup so the Module re-observes the real carrier/role state. Do not copy carrier facts through Platform config.

## Completion

Setup is complete only when the Module's own `status` reports `setupStatus=READY`. Re-running setup must re-observe reality; it must not resume from a blind historical step index.
