# execution-browser-extension configuration

Canonical public config: `.proflow/config/execution-browser-extension.json`

This file is Workspace-owned data. `platform uninstall` does not delete it. Values are JSON strings. Raw secrets must not be stored here; `secretRef` fields contain opaque references only.

## Fields

| Key | Type | Required | Sensitive | Source | Meaning |
|---|---|---:|---:|---|---|
| `bridge.endpoint` | `url` | yes | no | User or owning external/runtime Module supplies the reachable endpoint URL. | Loopback Browser Reality Bridge endpoint |
| `bridge.token` | `path` | yes | yes | User or owning Module supplies an absolute/local path that exists on this Workspace. | File containing the Browser Reality Bridge extension token |
| `taskApplication.endpoint` | `url` | yes | no | User or owning external/runtime Module supplies the reachable endpoint URL. | Loopback Platform Host Task application endpoint |
| `taskApplication.token` | `path` | yes | yes | User or owning Module supplies an absolute/local path that exists on this Workspace. | File containing the Platform Host Task application token |
| `approvalApplication.endpoint` | `url` | yes | no | User or owning external/runtime Module supplies the reachable endpoint URL. | Loopback Platform Host Approval application endpoint |
| `approvalApplication.token` | `path` | yes | yes | User or owning Module supplies an absolute/local path that exists on this Workspace. | File containing the Platform Host Approval application token |
| `verificationEvidenceFile` | `path` | yes | no | User or owning Module supplies an absolute/local path that exists on this Workspace. | JSON evidence file written after real Chrome loads the Deployment-managed MV3 extension and its Service Worker runs |
| `chromeRuntimeModuleRef` | `moduleRef` | no | no | Another installed ProFlow Module reference selected from `platform docs` / Module topology. | External resource module governing the Chrome runtime |
| `carrierModuleRef` | `moduleRef` | no | no | Another installed ProFlow Module reference selected from `platform docs` / Module topology. | External resource module governing the Custom GPT carrier |

## Materialize

Create or update the canonical JSON object at:

`.proflow/config/execution-browser-extension.json`

Use only declared keys and string values. Do not create a second Platform configuration database.

The Browser Extension also requires a package-owned physical runtime config artifact. After the canonical Module config is present, run `proflow-execution-browser-extension materialize-config --workspace <path>`. This package-owned command writes the private runtime artifact under `.proflow/deployment/browser-extension/execution-browser-extension/`; `platform start` must not perform this materialization implicitly.

## Base completion check

Run `platform modules`. This Module should no longer report required keys in `missingConfig`. `platform start` performs the authoritative Module-owned validation before starting anything.
