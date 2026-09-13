## 0.1.12

### Patch Changes

- Prune empty Task-level document recovery directories after recovery journals converge so durable recovery leaves no orphan filesystem residue.

- Harden Task-scoped Worker identity and generation semantics so reopened or invalidated executions cannot reuse stale Worker/conversation ownership or a previously consumed run generation.
