# execution-local configuration

Canonical public config: `.proflow/config/execution-local.json`

This file is Workspace-owned data. `platform uninstall` does not delete it. Values are JSON strings. Raw secrets must not be stored here; `secretRef` fields contain opaque references only.

## Fields

| Key | Type | Required | Sensitive | Source | Meaning |
|---|---|---:|---:|---|---|
| `projectRoot` | `path` | yes | no | User or owning Module supplies an absolute/local path that exists on this Workspace. | Canonical project boundary |
| `artifactRoot` | `path` | yes | no | User or owning Module supplies an absolute/local path that exists on this Workspace. | Execution-owned output and evidence directory |

## Materialize

Create or update the canonical JSON object at:

`.proflow/config/execution-local.json`

Use only declared keys and string values. Do not create a second Platform configuration database.

## Base completion check

Run `platform modules`. This Module should no longer report required keys in `missingConfig`. `platform start` performs the authoritative Module-owned validation before starting anything.
