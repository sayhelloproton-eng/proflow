# @tomflow/proflow-module-template

- Module: `module-template`
- Kind: `library`
- Install class: `core`
- Owner: `deployment-governance`

Materializes the six standard ProFlow Module profiles on a real filesystem. The generated package is born with the governance shape required by Module Contract, Registry/Workspace Discovery, Deployment Conformance and future AI-facing Platform CLI documentation.

## Create

Use the package's stable npm `bin` instead of hand-copying a scaffold:

```text
npx @tomflow/proflow-module-template create \
  --target <packages-directory> \
  --module-ref <moduleRef> \
  --package <@tomflow/proflow-...> \
  --kind <library|service|cli|browser-extension|agent-package|external-resource> \
  --install-class <core|optional> \
  --domain <domain> \
  --summary <text>
```

`installClass`, `domain` and `summary` are owner facts and must be supplied explicitly. The CLI delegates to the same `materializeModule()` implementation used by the library API.

Generated packages include ProFlow package discovery metadata, Descriptor/Adapter/Requirements/Verification, package-owned documentation entry, effect retention skeleton, Conformance configuration, and a thin package-owned `npx <package> install` entry. That entry never implements a second installer: it delegates to the Shell-global `platform install <self-package> --workspace <cwd>` and fails closed with `GLOBAL_PLATFORM_CLI_REQUIRED` if the global CLI is unavailable. It never transiently downloads another Platform CLI, so single-Workspace binding, Registry discovery, package-manager mutation and governance remain single-sourced in Platform CLI. The template does not invent business APIs, permissions, Provides/Requires or domain behavior.

Normative design: `spec/部署领域/04-模块/module-template/TECHNICAL-DESIGN.md`.
### Service profile runtime rule

Generated `service` packages no longer use an in-memory `RUNNING/STOPPED` variable as deployment reality. They receive a package-owned CLI with `install`, `--help`, and a fail-closed `start <config>` placeholder plus the `createServiceProcessBinding` seam. The owner implements the real long-running process and probes; Platform CLI owns detached supervision and cross-CLI PID/runtime state.

