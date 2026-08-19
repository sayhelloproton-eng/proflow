# platform-host configuration

Canonical public config: `.proflow/config/platform-host.json`

This file is Workspace-owned data. `platform uninstall` does not delete it. Values are JSON strings. Raw secrets must not be stored here; `secretRef` fields contain opaque references only.

## Fields

| Key | Type | Required | Sensitive | Source | Meaning |
|---|---|---:|---:|---|---|
| `stateRoot` | `path` | yes | no | User or owning Module supplies an absolute/local path that exists on this Workspace. | Absolute .proflow owner state root |
| `workspaceRoot` | `path` | yes | no | User or owning Module supplies an absolute/local path that exists on this Workspace. | Absolute Task document workspace root |
| `gatewayTransportCredentialFile` | `path` | yes | yes | User or owning Module supplies an absolute/local path that exists on this Workspace. | File containing the dedicated credential accepted from agent-gateway |
| `executionBaseUrl` | `url` | yes | no | User or owning external/runtime Module supplies the reachable endpoint URL. | Loopback Execution Runtime public transport |
| `executionTransportCredentialFile` | `path` | yes | yes | User or owning Module supplies an absolute/local path that exists on this Workspace. | File containing the credential used for Platform Host calls to Execution Runtime |
| `modelTransportCredentialFile` | `path` | yes | yes | User or owning Module supplies an absolute/local path that exists on this Workspace. | File containing the credential used for Platform Host calls to Model Runtime |
| `modelBaseUrl` | `url` | yes | no | User or owning external/runtime Module supplies the reachable endpoint URL. | Loopback Model Runtime public transport |

## Materialize

Create or update the canonical JSON object at:

`.proflow/config/platform-host.json`

Use only declared keys and string values. Do not create a second Platform configuration database.

## Base completion check

Run `platform modules`. This Module should no longer report required keys in `missingConfig`. `platform start` performs the authoritative Module-owned validation before starting anything.
