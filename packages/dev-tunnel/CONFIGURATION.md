# dev-tunnel configuration

Canonical public config: `.proflow/config/dev-tunnel.json`

This file is Workspace-owned data. `platform uninstall` does not delete it. Values are JSON strings. Raw secrets must not be stored here; `secretRef` fields contain opaque references only.

## Fields

| Key | Type | Required | Sensitive | Source | Meaning |
|---|---|---:|---:|---|---|
| `publicBaseUrl` | `url` | yes | no | User or owning external/runtime Module supplies the reachable endpoint URL. | Public HTTPS URL supplied by the dev-tunnel resource |
| `tunnelId` | `string` | no | no | User or owning Module supplies this value according to the field description. | Persistent Microsoft Dev Tunnel identifier used when this adapter owns lifecycle start/stop |
| `verificationEvidenceFile` | `path` | no | no | User or owning Module supplies an absolute/local path that exists on this Workspace. | JSON evidence for real file-relay and 429/5xx verification behind the configured public ingress |

## Materialize

Create or update the canonical JSON object at:

`.proflow/config/dev-tunnel.json`

Use only declared keys and string values. Do not create a second Platform configuration database.

## Base completion check

Run `platform modules`. This Module should no longer report required keys in `missingConfig`. `platform start` performs the authoritative Module-owned validation before starting anything.
