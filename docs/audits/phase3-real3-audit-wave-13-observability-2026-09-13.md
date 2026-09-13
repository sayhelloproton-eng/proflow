# Phase 3 Real-3 Audit｜Wave 13｜日志与可观测性

## Decision

Structured logs are technical shadows, not Effect truth. A boundary may emit `sideEffectState` only when it receives an authoritative state from the Effect-owning result/outcome. “This logger does not know” is represented by absence of the field, not by fabricating `UNKNOWN`.

## Mechanical findings

- Agent Gateway generated `sideEffectState=UNKNOWN` for every successful and failed Action boundary although Gateway does not own Effect reality.
- Platform Host generic application observer defaulted any result without an explicit Effect state to `UNKNOWN`, and also failed to preserve the valid authoritative `STARTED` state.
- Browser Extension generic recovery/browser-command/permission-failure logs similarly synthesized `UNKNOWN` without an Effect-owning outcome.
- Permission and Provisioning observers already receive authoritative `sideEffectState` from their typed outcomes and keep logging it.
- Browser session heartbeat is not emitted as a per-heartbeat operation log; session state logs only represent ONLINE/OFFLINE transitions.
- Page reality logging already suppresses unchanged `contentInstanceId/pageState/activityKind/blocker fingerprint` observations.

## Frozen correction

1. Gateway omits `sideEffectState` from ingress boundary logs.
2. Host emits it only when the invoked owner result explicitly supplies one of `NOT_STARTED/STARTED/APPLIED/NOT_APPLIED/UNKNOWN`.
3. Extension generic recovery/browser-command/permission-failure logs omit it; typed Permission/Provisioning outcomes preserve their authoritative value.
4. `status=UNKNOWN` may still represent transport/reporting uncertainty; it must not be conflated with Execution `sideEffectState=UNKNOWN`.

## Acceptance

Targeted Gateway/Host/Extension observability regression tests and all three package typechecks must pass. No runtime deployment or package release is part of Wave 13.
