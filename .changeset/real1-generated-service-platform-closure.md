---
"@tomflow/proflow-module-template": patch
"@tomflow/proflow-platform-cli": patch
---

Close the Real-1 generated-Service consumption path: generated packages now declare Node typings so an untouched Service template typechecks on Node 24, and Platform CLI resolves installed deployment adapters from the target product Workspace rather than from the CLI package location. Real-1 regression fixtures are synchronized with the current Module/Create contracts and now prove generated Service discovery, docs, and honest fail-closed lifecycle/verification behavior.
