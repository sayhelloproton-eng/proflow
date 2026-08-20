# @tomflow/proflow-model-runtime — Module Setup

Choose the provider model identifiers for `fastModel` and `reasonModel`. Provider endpoint/credential and capability facts come from the provider contract or Module-owned probing; they must not be manually copied through Platform config. Module.setup completes only after the selected FAST/REASON roles can be re-observed against the provider.

## Completion

Setup is complete only when the Module's own `status` reports `setupStatus=READY`. Re-running setup must re-observe reality; it must not resume from a blind historical step index.
