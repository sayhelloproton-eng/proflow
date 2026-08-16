# @tomflow/proflow-module-contract

- Module: `module-contract`
- Kind: `library`
- Install class: `core`
- Owner: `deployment-governance`

Exports the canonical ProFlow Module runtime schemas and inferred TypeScript contracts used by Module Template, Deployment Conformance, Platform CLI and AI-facing module discovery.

The contract covers:

- ProFlow package discovery metadata (`module`, `installClass`, `descriptor`);
- module identity/kind/version/platform compatibility;
- Provides / Requires and deployment requirements;
- config slots;
- lifecycle capabilities, including package-owned uninstall cleanup;
- verification;
- deployment effects and cleanup retention;
- package-owned documentation entries;
- structured deployment result/error and compatibility assessment.

This package defines governance shape only. It does not query npm Registry, install packages, start services or own another Module's business documentation.

Normative design: `spec/部署领域/04-模块/module-contract/TECHNICAL-DESIGN.md`.
