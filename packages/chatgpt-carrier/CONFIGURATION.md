# chatgpt-carrier configuration

Canonical public config: `.proflow/config/chatgpt-carrier.json`

This file is Workspace-owned data. `platform uninstall` does not delete it. Values are JSON strings. Raw secrets must not be stored here; `secretRef` fields contain opaque references only.

## Fields

| Key | Type | Required | Sensitive | Source | Meaning |
|---|---|---:|---:|---|---|
| `carrierUrl` | `url` | no | no | User or owning external/runtime Module supplies the reachable endpoint URL. | ChatGPT Custom GPT carrier entry URL |
| `verificationEvidenceFile` | `path` | yes | no | User or owning Module supplies an absolute/local path that exists on this Workspace. | JSON evidence file produced by the real Custom GPT verification workflow |

## Materialize

Create or update the canonical JSON object at:

`.proflow/config/chatgpt-carrier.json`

Use only declared keys and string values. Do not create a second Platform configuration database.

## Base completion check

Run `platform modules`. This Module should no longer report required keys in `missingConfig`. `platform start` performs the authoritative Module-owned validation before starting anything.
