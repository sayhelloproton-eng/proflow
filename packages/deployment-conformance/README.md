# @tomflow/proflow-deployment-conformance

Mechanical conformance checks for the current ProFlow Module governance surface.

## Checks

- formal ProFlow package identity and lightweight discovery metadata;
- static `proflow.module.json` and runtime descriptor consistency;
- Module identity/version/kind/platform compatibility;
- Runtime `provides/requires` graph facts;
- config slots and documentation entries;
- Module-owned status observation shape;
- real lifecycle declaration/adapter compatibility;
- configuration guidance for config-bearing Modules.

## Removed install-model checks

Conformance no longer treats `installClass`, `installRequires`, Core/Optional classification, package-owned self-install, Plan/Apply/Verify/Doctor/Manifest or Platform-owned service supervision as current product requirements.

## Boundary

Conformance proves governance shape, not business correctness or real external-resource availability. Business E2E remains owned by the corresponding Domain and final human acceptance.
