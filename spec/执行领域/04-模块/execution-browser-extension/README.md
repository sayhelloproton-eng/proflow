---
docId: EXECUTION-EXECUTION-BROWSER-EXTENSION-README
title: '`execution-browser-extension`'
docType: module-readme
authority: normative
lifecycle: active
domain: execution
moduleRef: execution-browser-extension
contractRefs:
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
---

# `execution-browser-extension`

Execution-owned Chrome MV3 Carrier for Custom GPT Conversations.

v1 responsibilities:

```text
Task/New Task UI + approval/alert channel
Task Observer (deterministic progression)
System Observer (lowest-priority whole-system assessment)
Background Carrier Controller
Conversation CREATE/RESTORE/WAKE
c-id/URL observation
DOM-first input/submit/observe
screenshot → Vision fallback
physical Collaboration delivery
Browser Effect recovery/evidence
Side Panel
```

It does **not** own Task/Agent business facts, ordinary file transport, GPT reasoning, or a second effect/state runtime. No frame registry/iframe workspace/persistent tab identity. See the detailed technical design for J1–J6 integration.
