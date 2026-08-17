## 0.1.1

### Patch Changes

- Read installed package versions directly from the Workspace `node_modules` package manifest so postcondition checks cannot reuse stale Node module-resolution cache entries after an in-process package upgrade.
