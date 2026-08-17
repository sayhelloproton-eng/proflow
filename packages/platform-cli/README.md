# platform-cli

Domain Owner: deployment-governance  
Module Kind: cli  
Service: none  
Process: none  
Business Fact Owner: none

## Purpose

The single platform-level deterministic Deployment planner/executor and v1 global `platform` control plane. It understands only the Module Contract and public lifecycle/verification contracts; it does not import other domains' business internals. The global CLI binary is distinct from the single bound Platform Instance.

For the v1 Custom GPT carrier it may plan/verify Web-only setup, role-scoped Action auth/schema, File Bridge/Code Interpreter/Web Search requirements, `x-openai-isConsequential:false` + Always Allow target configuration, Chrome/runtime prerequisites and current verification freshness. It never creates/guesses Task `workerRef/c-id`, never uses exact ChatGPT model id as READY truth, and never accepts System Observer assessment as Deployment READY truth.

## Global CLI bootstrap

The v1 `platform` command is a Shell-global control plane. A straightforward bootstrap is:

```text
npm install --global @tomflow/proflow-platform-cli
```

This choice installs the global CLI only. It does **not** force the managed Workspace to use npm: a bound Workspace may independently use `npm`, `yarn`, or `pnpm`, selected from its own package-manager facts.

## Commands

```
platform search [package]
platform modules [module|package]
platform docs [module|package] [documentId]
platform preflight [module]
platform preflight --intent install
platform install [package] [--workspace <path>]
platform uninstall [module|package]
platform upgrade [module|package]
platform plan --intent install|configure|upgrade|uninstall|repair [options]
platform apply <planRef>
platform start [module]
platform stop [module]
platform restart [module]
platform status [module]
platform verify [module]
platform doctor [module]
platform manifest [module]
```

`install` / `upgrade` / `uninstall` are AI-friendly high-level commands that reuse the same frozen Plan -> Apply engine. `search` reads the npm Registry installable world; `modules` reads the current Workspace managed world; `docs` mechanically aggregates package-owned Descriptor, npm `bin/exports`, and declared documentation without maintaining a second package-knowledge catalog. Package mutation is real Workspace package-manager mutation and is never satisfied by the historical no-op driver seam.


## v1 global workspace semantics

- The `platform` binary is installed globally and can be invoked from any shell directory.
- At most one ProFlow Workspace may be bound globally at a time.
- `platform install` targets the current working directory by default; `platform install --workspace <path>` explicitly selects the requested Workspace for Agent/automation use.
- Requested Workspace paths are canonicalized before binding comparison. A second distinct Workspace is rejected with `WORKSPACE_ALREADY_BOUND` until the current Platform Instance is uninstalled.
- `status/start/stop/restart/modules/docs/verify/doctor/upgrade/uninstall` resolve the durable global binding rather than the caller's cwd. `platform status` exposes the bound Workspace path.
- `platform uninstall` without a module/package removes the current Platform Instance and clears its binding; it does not uninstall the global CLI package.
- Workspace package mutation is package-manager agnostic for v1: `npm`, `yarn`, and `pnpm` are supported. The CLI installation manager and the bound Workspace manager are independent facts.
