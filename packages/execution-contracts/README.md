# @tomflow/proflow-execution-contracts

Typed public Execution contracts and runtime validation for the ProFlow real-world effect plane.

Normative source: `spec/执行领域/02-契约/01-Public-Contract与TypeScript类型规范.md`.

## v1 Journey contract alignment

The public contract keeps stable business refs separate from transient Browser runtime identity and now treats `ArtifactRef` and `EvidenceRef` as different semantics. It exposes no WorkerTurn/Observer store contract and no frame/persistent-tab business identity.
