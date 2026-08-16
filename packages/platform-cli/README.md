# platform-cli

Domain Owner: deployment-governance  
Module Kind: cli  
Service: none  
Process: none  
Business Fact Owner: none

## Purpose

The single platform-level deterministic Deployment planner/executor. It understands only the Module Contract and public lifecycle/verification contracts; it does not import other domains' business internals.

For the v1 Custom GPT carrier it may plan/verify Web-only setup, role-scoped Action auth/schema, File Bridge/Code Interpreter/Web Search requirements, `x-openai-isConsequential:false` + Always Allow target configuration, Chrome/runtime prerequisites and current verification freshness. It never creates/guesses Task `workerRef/c-id`, never uses exact ChatGPT model id as READY truth, and never accepts System Observer assessment as Deployment READY truth.

## Commands

```
platform search [package]
platform modules [module|package]
platform docs [module|package] [documentId]
platform preflight [module]
platform preflight --intent install
platform install [package]
platform uninstall <module|package>
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
