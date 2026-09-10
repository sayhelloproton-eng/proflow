## 0.1.53

### Patch Changes

- Report the owned Browser Reality Bridge as STOPPED or RUNNING after setup so platform start actually starts the bridge listeners required by worker.create and direct tools.

  Keep setup readiness independent of stopped listeners and report failed bridge probes as FAILED instead of claiming RUNNING. Preserve existing Extension pairing and session revalidation gates.

  Reject malformed Bridge session responses, preserve setup facts on probe failures, and close the Browser listener when Direct Tool Executor construction fails.
