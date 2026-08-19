# agent-controller-dev configuration

Canonical public config: `.proflow/config/agent-controller-dev.json`

This file is Workspace-owned data. `platform uninstall` does not delete it. Values are JSON strings. Raw secrets must not be stored here; `secretRef` fields contain opaque references only.

## Fields

| Key | Type | Required | Sensitive | Source | Meaning |
|---|---|---:|---:|---|---|
| `carrierModuleRef` | `moduleRef` | no | no | Another installed ProFlow Module reference selected from `platform docs` / Module topology. | External resource module governing the Custom GPT carrier |

## Materialize

Create or update the canonical JSON object at:

`.proflow/config/agent-controller-dev.json`

Use only declared keys and string values. Do not create a second Platform configuration database.

## Base completion check

Run `platform modules`. This Module should no longer report required keys in `missingConfig`. `platform start` performs the authoritative Module-owned validation before starting anything.
