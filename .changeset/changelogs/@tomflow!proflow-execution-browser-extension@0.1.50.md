## 0.1.50

### Patch Changes

- Preserve Observer recovery demand while a recovery pass is already in flight by coalescing reconnect, retry, and recovery requests into one trailing pass, without introducing concurrent recovery or stale retry replay.
