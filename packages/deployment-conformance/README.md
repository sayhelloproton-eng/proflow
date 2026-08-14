# @tomflow/proflow-deployment-conformance

- Module: `deployment-conformance`
- Kind: `cli`
- Owner: `deployment-governance`

Runs C1 Static Contract, C2 Package, C3 Behavior, and GPT Actions/File Bridge conformance. It does not replace business-domain tests or claim real External Resource availability. Normative design: `spec/部署领域/04-模块/deployment-conformance/TECHNICAL-DESIGN.md`.

## Custom GPT carrier conformance

Conformance validates declared Agent/Carrier requirements and static contracts only. It must reject stale Product New Task Action surfaces, exact-model readiness pins, or descriptors that treat tab/frame/c-id-from-Actions as business identity. It does not prove real ChatGPT/Chrome behavior; real readiness remains Deployment verification/final external E2E.
