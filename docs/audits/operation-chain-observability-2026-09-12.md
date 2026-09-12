# Independent operation-chain observability audit

Audit baseline: `468ea5a`; audited implementation `decbfaa`; starting HEAD `eae13c414e7cf7db501e29b4000287522122d0d7`. Source-only remediation. No commit, release, deployment, install, lockfile/version modification, or business policy change authorized/performed.

## INDEPENDENT_DESIGN

The following note was frozen in `/tmp/proflow-observability-audit/phase-a.md` before reading the observability diff/current implementation. It is an independent proposal, not a claim that every preferred mechanism exists in the patch.

# Phase A frozen independent design
Frozen before reading decbfaa diff or current observability implementation. Baseline 468ea5a, verified HEAD eae13c414e7cf7db501e29b4000287522122d0d7.

1. Ownership: Gateway ingress observer wraps authenticated Action/Direct Tool routing independently of service lifecycle logs. Host owns a common application/owner invocation observer, used by HTTP and in-process entry points. Extension composition owns observer adapters for session, command, page transition, permission, local tool, provisioning and recovery. Controllers return outcomes; no persistent sinks. Tool invocation wraps the common dispatch port, not providers.
2. Envelope: version, eventId, producer/session and monotonic sequence, observedAt, boundary, operation name/ref, explicit parent ref when propagated, phase/start/end, outcome/decision, categorical reason distinct from errorCode, duration, sideEffectState APPLIED/NOT_APPLIED/UNKNOWN/NOT_APPLICABLE, bounded allowlisted identity/evidence refs. No raw input/result/error messages.
3. Correlation: random per invocation operationRef, propagated only across controlled transport; EXACT requires explicit operation/parent identity; IDENTITY_MATCH is an owner identity join and never causal proof; ADJACENT is temporal context, excluded from causal attribution. Direct Tool never requires Task identity. A trace spanning ChatGPT UI is incomplete by construction.
4. Extension buffer: one bounded persisted outbox (count/bytes/age), serialized storage updates, producer sequence, immutable batches, single-flight flush, acknowledge only explicitly accepted event IDs, preserve concurrently appended events, at-least-once and sink dedupe. Storage/network failure cannot reject business work. Overflow/drop counter and gaps explicit. Restart/reconnect triggers logging-only flush, never business retry.
5. Sinks: Gateway local sink for ingress, Host one shared append owner accepting sanitized extension events and Host events; Extension one outbox storage owner. Existing lifecycle sinks remain separate. Restrictive permissions, bounded retention/rotation, no unbounded memory queues. Whole repo mechanical sink inventory.
6. Diagnosis: one read-only operation/correlation query, normalize safe evidence summaries from existing Task/Execution/Local/Model/Browser/Gateway authorities. Output historical events separately from current owner facts and unavailable sources. No second business store.
7. First divergence: traverse explicit causal edges, not wall-clock sorting. Identify earliest failed/denied/unknown boundary within exact chain, retain successful predecessor and downstream symptoms. Concurrent branches/unobserved edges return ambiguity/gap, not invented root cause. Identity/adjacent evidence displayed separately. Never interpret a successful transport as applied effect.
8. Security: schema allowlist at every sink including imported events; reject/strip unknown keys recursively, bound strings/arrays. URL removes userinfo/query/hash. Codes categorical, arbitrary exception text excluded. No credentials, Action inputs, chat/composer/file text, screenshots/base64 or prompts.
9. Noise/retention: page observer emits semantic transitions, not mutation/heartbeat/poll cycles; coalesce repetitive unchanged states with bounded counters. Explicit retention defaults (e.g. 7 days/10 MiB server, 1000 events/1 MiB outbox), surface dropped evidence.
10. Tests: runtime behavioral RED/GREEN for common boundaries, unchanged return/error and permission/task semantics, sink failure isolation, redaction adversarial payloads, offline restart/ACK/concurrency/overflow, exact vs identity joins, skew/branches/downstream failure diagnosis, authority unavailability. Mechanical tests complement but do not replace behavior. Required package full tests/typechecks, selected root build, diff check; no publish/deploy.

## COMPARISON

| Area | Original classification | Disposition |
|---|---|---|
| Extension composition observer | MATCH | Keep structured outcome adapters; controllers do not own log persistence. |
| operation-observer God Object concern | ACCEPTABLE_DIFFERENCE | Projection-only adapter with injected logger, no lifecycle/policy/store authority. Splitting per provider would add indirection without fixing a defect. |
| Gateway lifecycle vs operation | DEFECT | Separate callbacks were wired to the same file; separate lifecycle.jsonl and events.jsonl now. |
| Gateway ingress coverage / sink isolation | DEFECT | Early rejection missing; callback failure could fail successful request. Add ingress rejection observer and failure isolation. |
| Host application boundary | MISSING | Extension client impersonated a server boundary. Add Host common application/owner decorator and explicit source labels. |
| Direct Tool | MATCH / MISSING | Task-agnostic DTO preserved; add Host common tool-invocation observer, no provider logging. |
| Extension offline buffer | DEFECT | Persisted bounded queue existed, but remote projection lost event identity/time/semantics; unhandled storage/flush failures and startup blocking. Fix envelope, ACK, dedupe, limits and isolation. |
| reason/errorCode | DEFECT | Policy reason was promoted to error code. Preserve distinct fields. |
| correlation / operationRef | DEFECT | Function names and permission fingerprints treated as traces. Use per-call transport refs; permission facts remain IDENTITY_MATCH. |
| first divergence | DEFECT | Time-adjacent symptom could become root cause. Explicit query scope, child/parent failure relation, ambiguity instead of fabricated attribution. |
| durable evidence reuse | DEFECT / MISSING | Wrong Execution path; no Execution current facts. Read existing Task/Execution databases read-only; reuse Local/Model/Gateway/Browser logs. |
| secrets / schema | DEFECT | Host URL unredacted; persisted event loaded by cast. Validate/select bounded fields, strip URL credentials/query/hash, reject payload keys at ingestion. |
| page mutation / heartbeat flood | MATCH | Page semantic transitions and session state changes retained; no heartbeat/poll events added. Queue count/byte limits and drop visibility added. |
| tests | DEFECT | Behavioral happy-path tests existed, but bad attribution and field-loss semantics were asserted; mechanical grep was not sufficient. Add offline/ACK/race/sink failure/causality behavior tests. |
| existing Task/Execution semantics | MATCH | Read authority, never create a second business truth store or retry UNKNOWN effects. |

## FINDINGS AND CHANGES_APPLIED

- HIGH: `extension-logger.ts`, `application-client.ts`, Host ingestion: remote projection discarded original timestamp, event ID/sequence, correlation confidence, decision/reason and sideEffectState. Preserve full bounded envelope, explicit event ACK, and replay dedupe in retained Host evidence. Storage/remote failures are observation failures, not business failures; startup no longer awaits log drain.
- HIGH: `operation-chain-diagnose.mjs`: arbitrary correlation IDs were classified EXACT, time order selected unrelated symptoms, and the latest Task anchor discarded earlier causes. Operation/correlation/execution queries now scope exact evidence; explicit failed child precedes parent symptom even with clock skew. Independent branches stay ambiguous. IDENTITY_MATCH/ADJACENT never establish root cause.
- HIGH: `platform-host/src/index.ts`: no actual Host application observer. Add one decorator for Action routing, task/approval/observer/role application calls, execution/model owner calls, execution identity admission, and common Direct Tool invocation. Safe transport-only operation refs link Gateway or Extension client to Host. Business inputs and decisions stay unchanged.
- HIGH: Gateway process callback exceptions could replace successful results; asynchronous append failures were unhandled. Isolate callbacks/queue failures and cap queue/segments. Record pre-owner ingress rejection without request payload.
- HIGH: `browser-session-lane.ts`, `provisioning-lane.ts`: thrown result-upload failures lost the command outcome. Always report the structured outcome in finally, retaining unconfirmed delivery and known effect state; never replay the effect.
- MEDIUM: static application operation names and permission fingerprints created misleading identity. Per-call operation refs replace names; permission evidence is explicitly identity-only. Recovery's no-op observer now emits bounded start/settled observations; settled remains UNKNOWN rather than claiming business success.
- MEDIUM: Host ingestion trusted URL contents and restored outbox trusted unknown extra fields. Sanitize at ingestion/recovery and reject sensitive payload keys; no exception text or business payload is copied.
- MEDIUM: unbounded Gateway/Host files and no buffer loss accounting. Use bounded append queues and two 5 MiB segments per source; Extension caps count and serialized size and exposes droppedEvents. Server rotation is size-driven with idle-age rollover, not a guaranteed wall-clock deletion service.

## Sink inventory and limits

New operation persistence is centralized in three places: Gateway deployment append owner, Host `createOperationSink` (Host + Extension ingestion), and Extension `createExtensionLogger` outbox storage. Existing Task, Execution, Local and Model persistence remains owner authority. Recovery's stored assessment is existing derived assessment state, not a log sink or Task truth.

Host append completion is the ACK boundary, not a power-loss/fsync guarantee. Dedupe is bounded by retained IDs/segments, not an eternal exactly-once promise. Outbox is at-least-once under available browser storage; storage denial is explicitly degraded and cannot promise crash durability. Overflow can evict an in-flight oldest event; ACK removes only its matching ID and cannot remove a new head.

## Diagnostic usage

```sh
node scripts/operation-chain-diagnose.mjs --workspace /path/to/proton-workspace --operation op:UUID --json
node scripts/operation-chain-diagnose.mjs --workspace /path/to/proton-workspace --correlation CORRELATION --json
node scripts/operation-chain-diagnose.mjs --workspace /path/to/proton-workspace --execution EXECUTION_REF --json
node scripts/operation-chain-diagnose.mjs --workspace /path/to/proton-workspace --task TASK_ID --json
```

Historical timeline and currentOwnerFacts are separate. Missing/corrupt authority is unavailable, not healthy/empty evidence. A successful transport is not proof of APPLIED effect. A boundary finding is an observed divergence, not automatically the physical root cause. Across uncontrolled ChatGPT UI, operation continuity must remain a gap.

## RESIDUAL_RISKS

- Published versions and live runtime are untouched; these changes are only source changes. Old Host versions cannot ACK the new envelope; the bounded outbox retains events until a compatible Host is used in a separately authorized lifecycle.
- Real Chrome MV3 suspension, storage quota/denial, restart, Host disconnect/reconnect and end-to-end ACK acceptance require real runtime validation. Timer flush runs while the worker is active; startup flush covers restart.
- There is no trustworthy propagation through ChatGPT UI. Direct Tool invocation is observed without Task coupling; temporal/identity joins cannot prove tool-to-UI causality.
- Missing logs, eviction, retained-segment limits and concurrent failures may prevent a unique last-success/root-cause conclusion. Diagnostic output must retain that uncertainty.
- Existing owner logs are reused, not migrated or rewritten. Existing owner lifecycle/persistence robustness outside this observability patch is not expanded into unrelated refactoring.

## HANDOFF_TO_CHATGPT

Do not repeat the repository-wide audit. Review this patch and its test evidence, then only complete unblocked local HTTP tests and a separately authorized Chrome/runtime acceptance: offline event generation, worker restart, reconnection/ACK, one Gateway-to-Host request, one Direct Tool invocation without Task identity, and one uncertain-effect observation with zero business retry. Compare owner facts against the unified query. Do not publish/deploy/start/setup without a new authorized lifecycle task.

## VERIFICATION

Pending final command result ledger below.
