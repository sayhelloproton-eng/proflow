## 0.1.3

### Patch Changes

- Close the Real-1 global Platform control-plane contract across every published ProFlow package. Platform CLI now owns one durable global Workspace binding with canonical identity, cross-process operation locking, cwd/`--workspace` install targeting, cross-directory instance commands, whole-instance uninstall/rebind, and deterministic npm/yarn/pnpm Workspace package-manager selection. Every package-owned install entry, including newly generated Module Template packages, delegates to the Shell-global `platform` command and fails closed when that global CLI is unavailable; Deployment Conformance and the formal test plans mechanically enforce the same rule across all 24 packages.
