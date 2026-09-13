# Phase 3 Real-3 Audit｜Wave 17 Security & Authorization

Date: 2026-09-13
Status: FROZEN implementation applied only after authority-gated whole-file replacement; DONE requires the targeted verification plan to pass.

## Scope

Wave 17 audits the Role capability matrix, Gateway/Host admission, Browser Effect Gate, Product/Dev/Test privilege separation, credential/secret storage, operation logging, and fail-closed security behavior. Waves 01-16 were not rescanned.

## Findings

- Role capabilities are least-privilege: Product Direct Tool access is read-only, Controller/Dev owns mutate, and Test/Ops has no mutate permission. Operation admission is allowlist based.
- Platform Host rejects undeclared role operations, validates Direct Tool operation/input scope, canonicalizes Task worker identity, and validates Task-bound workers before mutation.
- Browser Action permission handling is fail-closed. Automatic handling only chooses routine `allowAlways`/`allow`, while `allowOnce`/`deny` remain human Attention actions. Fingerprint and current page reality are revalidated before effects, and unknown automatic outcomes are not blindly replayed.
- Module and browser secret material is written under private directories/files (`0700`/`0600`). Agent Runtime persists the durable role credential store as `0600`.
- Structured operation logging does not persist raw Authorization headers or bearer values. Host logging extracts allowlisted axes; Browser logging is strict and sanitizes locators; Gateway boundary logs record identifiers/status/error codes rather than credentials.

## First divergence and fix

The public Agent Gateway independently enforced POSIX private permissions for its downstream transport token, but `role-credentials.json` was only parsed. If that role credential store was accidentally changed to group/world-readable permissions after creation, Gateway startup and authentication could still consume it.

`readCurrentCredentialStore` now stats the role credential store and rejects any POSIX mode with group/world bits using `ROLE_CREDENTIAL_STORE_PERMISSIONS_INVALID`. Because authentication reloads the durable store on each request, the same fail-closed check also applies to post-start permission drift.

## Regression proof

The Agent Gateway process regression now proves both security boundaries: an over-permissive role credential store is rejected, and an over-permissive downstream transport credential remains rejected. The running-Gateway credential-rotation proof also verifies that chmod drift to `0644` causes authentication to fail closed and that restoring `0600` restores the current credential authority.

Targeted verification additionally covers Gateway tests/typecheck, Platform Host tests, Browser permission semantics, all three role package static suites, changeset status, and `git diff --check`.

No package publish, install, version application, deployment, or runtime restart is part of Wave 17. Runtime adoption remains deferred to the later release/install closure defined by the full-chain audit plan.
