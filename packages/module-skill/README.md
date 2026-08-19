# @tomflow/proflow-module-skill

AI guidance for creating and maintaining ProFlow Module packages using the current Contract, Template and Conformance rules.

## Frozen responsibility model

```text
Module = config/status/validate/lifecycle truth
Platform CLI = discovery/aggregation/dispatch/ordering
Package manager = npm dependency mutation
```

The Skill must not reintroduce `installClass`, `installRequires`, package-local single install, or Platform Plan/Apply/Verify/Doctor/Manifest workflows.

For config-bearing Modules, documentation must explain each field's source, format, sensitivity, materialization procedure and basic completion check so `platform docs` is sufficient for AI setup guidance.
