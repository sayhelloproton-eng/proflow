# model-runtime configuration

Canonical public config: `.proflow/config/model-runtime.json`

This file is Workspace-owned data. `platform uninstall` does not delete it. Values are JSON strings. Raw secrets must not be stored here; `secretRef` fields contain opaque references only.

## Fields

| Key | Type | Required | Sensitive | Source | Meaning |
|---|---|---:|---:|---|---|
| `stateRoot` | `path` | yes | no | User or owning Module supplies an absolute/local path that exists on this Workspace. | Absolute .proflow owner state root |
| `transportCredentialFile` | `path` | yes | yes | User or owning Module supplies an absolute/local path that exists on this Workspace. | File containing the dedicated local credential required by Model Runtime callers |
| `providerBaseUrl` | `url` | yes | no | User or owning external/runtime Module supplies the reachable endpoint URL. | OpenAI-compatible provider API base URL |
| `providerCredential` | `secretRef` | no | yes | User/credential owner supplies an opaque `secret://...` reference; never place the raw secret in this file. | Credential reference resolved outside module configuration |
| `fastModel` | `string` | yes | no | User or owning Module supplies this value according to the field description. | Provider model identifier for FAST |
| `reasonModel` | `string` | yes | no | User or owning Module supplies this value according to the field description. | Provider model identifier for REASON |
| `capabilityProfilesFile` | `path` | yes | no | User or owning Module supplies an absolute/local path that exists on this Workspace. | JSON file containing Deployment-configured FAST/REASON ModelCapabilityProfile values |
| `providerModuleRef` | `moduleRef` | no | no | Another installed ProFlow Module reference selected from `platform docs` / Module topology. | External resource module governing the provider API |

## Materialize

Create or update the canonical JSON object at:

`.proflow/config/model-runtime.json`

Use only declared keys and string values. Do not create a second Platform configuration database.

## Base completion check

Run `platform modules`. This Module should no longer report required keys in `missingConfig`. `platform start` performs the authoritative Module-owned validation before starting anything.
