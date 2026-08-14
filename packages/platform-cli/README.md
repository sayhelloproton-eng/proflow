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
