# platform-cli

Domain Owner: deployment-governance
Module Kind: cli
Service: none
Process: none
Business Fact Owner: none

## Purpose

The single platform-level deterministic Deployment planner/executor. It
understands only the Module Contract and public lifecycle/verification
contracts; it does not import other domains' business internals.

## Commands

```
platform preflight [module]
platform plan --intent install|configure|upgrade|repair [options]
platform apply <planRef>
platform start [module]
platform stop [module]
platform status [module]
platform verify [module]
platform doctor [module]
platform manifest [module]
```
