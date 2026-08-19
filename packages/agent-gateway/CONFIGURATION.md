# agent-gateway configuration

Canonical public config: `.proflow/config/agent-gateway.json`

This file is Workspace-owned data. `platform uninstall` does not delete it. Values are JSON strings. Raw secrets must not be stored here; `secretRef` fields contain opaque references only.

## Fields

| Key | Type | Required | Sensitive | Source | Meaning |
|---|---|---:|---:|---|---|
| `localBaseUrl` | `url` | yes | no | User or owning external/runtime Module supplies the reachable endpoint URL. | Loopback HTTP listener URL owned by Agent Gateway and targeted by the public ingress resource |
| `publicBaseUrl` | `url` | yes | no | User or owning external/runtime Module supplies the reachable endpoint URL. | Public HTTPS URL supplied by the dev-tunnel resource |
| `downstreamCredentialFile` | `path` | yes | yes | User or owning Module supplies an absolute/local path that exists on this Workspace. | File containing the dedicated Gateway-to-platform-host transport credential |
| `publicIngressModuleRef` | `moduleRef` | no | no | Another installed ProFlow Module reference selected from `platform docs` / Module topology. | External resource module governing the public ingress |

## Materialize

Create or update the canonical JSON object at:

`.proflow/config/agent-gateway.json`

Use only declared keys and string values. Do not create a second Platform configuration database.

## Base completion check

Run `platform modules`. This Module should no longer report required keys in `missingConfig`. `platform start` performs the authoritative Module-owned validation before starting anything.
