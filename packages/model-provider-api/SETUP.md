# @tomflow/proflow-model-provider-api — Module Setup

Provide the real OpenAI-compatible provider endpoint through `providerBaseUrl` and, when required, the `providerCredential` secret reference. Module.setup must probe/re-observe the external provider rather than trusting configuration presence alone.

## Completion

Setup is complete only when the Module's own `status` reports `setupStatus=READY`. Re-running setup must re-observe reality; it must not resume from a blind historical step index.
