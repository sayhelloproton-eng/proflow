# model-provider-api configuration

Canonical public config: `.proflow/config/model-provider-api.json`

This file is Workspace-owned data. `platform uninstall` does not delete it. Values are JSON strings. Raw secrets must not be stored here; `secretRef` fields contain opaque references only.

## Fields

| Key | Type | Required | Sensitive | Source | Meaning |
|---|---|---:|---:|---|---|
| `providerBaseUrl` | `url` | yes | no | User or owning external/runtime Module supplies the reachable endpoint URL. | OpenAI-compatible provider API base URL |
| `providerCredential` | `secretRef` | no | yes | User/credential owner supplies an opaque `secret://...` reference; never place the raw secret in this file. | Optional credential reference; absent for unauthenticated providers |

## Materialize

Create or update the canonical JSON object at:

`.proflow/config/model-provider-api.json`

Use only declared keys and string values. Do not create a second Platform configuration database.

## Base completion check

Run `platform modules`. This Module should no longer report required keys in `missingConfig`. `platform start` performs the authoritative Module-owned validation before starting anything.
