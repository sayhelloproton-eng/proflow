## 0.1.4

### Patch Changes

- Detach the managed dev-tunnel host from the short-lived Platform CLI process and persist an ownership-checked process record so later status/stop/restart invocations can manage the same tunnel without turning `platform start` into a daemon.
