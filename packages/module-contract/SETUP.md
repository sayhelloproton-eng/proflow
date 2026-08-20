# @tomflow/proflow-module-contract — Module Setup

No user or external setup is required by the current frozen Module contract. `Module.install` completes deterministic preparation; `Module.setup` only re-observes current reality and must not ask the user to supply private paths, loopback endpoints, tokens or cross-Module facts.

## Completion

Setup is complete only when the Module's own `status` reports `setupStatus=READY`. Re-running setup must re-observe reality; it must not resume from a blind historical step index.
