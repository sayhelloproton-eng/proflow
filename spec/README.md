# ProFlow Phase 3 Frozen Truth

The canonical readable Frozen source is [`frozen/phase3/source/`](frozen/phase3/source/).
This landing uses `FROZEN_DIRECTORY_FALLBACK`; its source and independent verification
record are in [`frozen/phase3/SOURCE-PROVENANCE.json`](frozen/phase3/SOURCE-PROVENANCE.json).

The expected original artifact hashes are:

```text
DDD/SDD:   69fdfbac8a5ee36b700bcb10c0b8a9a61f0a5aa3367386cb5bc7e98118a4a875
Test Plan: 766663725f95ae4cecb71d3bc5bc2e6311f3ba7d150a0d12b387d67cb0e75669
```

The original ZIP artifacts were unavailable during this landing, so those ZIP hashes
were not reverified and must not be reported as passing. The copied Frozen directory
content was independently verified against its Manifest, conformance data, Test Plan
index, TODO traceability, and Critical Proof bindings.

Authority order:

1. FINAL FROZEN DDD/SDD in `frozen/phase3/source/`.
2. FINAL FROZEN Test Plan in the same directory.
3. Current ProFlow code that has passed the required TDD gates.
4. `../ai-agent-platform/` evidence only when the current task explicitly authorizes it.

Files under `frozen/phase3/source/` are immutable. Do not rewrite, rename, reorganize,
or reinterpret them. Implementation naming is a separate mechanical mapping defined by
[`IMPLEMENTATION-NAMING-BASELINE.md`](IMPLEMENTATION-NAMING-BASELINE.md).

Concrete Test Cases, actual results, and evidence are added only during later TDD work
under the Frozen Test Plan's specified `08-测试用例与验证` paths. This repository does not
redesign the Frozen Spec.
