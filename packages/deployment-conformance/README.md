# @tomflow/proflow-deployment-conformance

- Module: `deployment-conformance`
- Kind: `cli`
- Install class: `core`
- Owner: `deployment-governance`

Runs the single ProFlow Module governance gate:

- C1 Static Contract: Descriptor identity/installClass/Provides/Requires/lifecycle/effects/docs.
- C2 Package: npm package identity/exports, `package.json.proflow`, Descriptor consistency, package-owned docs and a stable package-owned `npx <package> install` entry.
- C3 Behavior: declared lifecycle operations return structured results and do not exceed declared effect ownership.

The package does not query npm Registry install candidates, install/remove packages, replace business-domain tests, or claim real External Resource availability.

Normative design: `spec/部署领域/04-模块/deployment-conformance/TECHNICAL-DESIGN.md`.

## Custom GPT carrier conformance

Existing Custom GPT / File Bridge conformance remains a parallel profile. It validates declared Agent/Carrier contracts but does not prove real ChatGPT/Chrome behavior; real readiness remains Deployment verification/final external E2E.
