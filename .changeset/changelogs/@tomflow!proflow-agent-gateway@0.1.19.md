## 0.1.19

### Patch Changes

- Preserve allowlisted downstream tool error codes across Gateway HTTP translation while keeping unknown failures opaque, and stop generic Gateway logs from fabricating side-effect state.

- Fail closed when the public Gateway role credential store becomes group/world-readable on POSIX systems.
