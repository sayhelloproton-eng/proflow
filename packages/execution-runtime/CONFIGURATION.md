# execution-runtime configuration

Canonical public config: `.proflow/config/execution-runtime.json`

This file is Workspace-owned data. `platform uninstall` does not delete it. Values are JSON strings. Raw secrets must not be stored here; `secretRef` fields contain opaque references only.

## Fields

| Key | Type | Required | Sensitive | Source | Meaning |
|---|---|---:|---:|---|---|
| `databasePath` | `path` | yes | no | User or owning Module supplies an absolute/local path that exists on this Workspace. | Execution SQLite database |
| `projectRoot` | `path` | yes | no | User or owning Module supplies an absolute/local path that exists on this Workspace. | Canonical project boundary consumed by the local executor |
| `artifactRoot` | `path` | yes | no | User or owning Module supplies an absolute/local path that exists on this Workspace. | Execution-owned Artifact/Evidence filesystem root |
| `browserExecutorConfigPath` | `path` | yes | no | User or owning Module supplies an absolute/local path that exists on this Workspace. | Absolute configuration path for the formal Browser Reality Bridge composition |
| `transportCredentialFile` | `path` | yes | yes | User or owning Module supplies an absolute/local path that exists on this Workspace. | File containing the Execution Runtime transport credential |
| `identity.endpoint` | `url` | yes | no | User or owning external/runtime Module supplies the reachable endpoint URL. | Loopback platform-host execution identity endpoint |
| `identity.tokenFile` | `path` | yes | yes | User or owning Module supplies an absolute/local path that exists on this Workspace. | File containing the Execution-to-platform-host identity transport credential |
| `modelDecision.endpoint` | `url` | yes | no | User or owning external/runtime Module supplies the reachable endpoint URL. | Loopback Model Runtime endpoint used by execution.command-risk.v1 |
| `modelDecision.credentialFile` | `path` | yes | yes | User or owning Module supplies an absolute/local path that exists on this Workspace. | File containing the Execution-to-Model transport credential |

## Materialize

Create or update the canonical JSON object at:

`.proflow/config/execution-runtime.json`

Use only declared keys and string values. Do not create a second Platform configuration database.

## Base completion check

Run `platform modules`. This Module should no longer report required keys in `missingConfig`. `platform start` performs the authoritative Module-owned validation before starting anything.
