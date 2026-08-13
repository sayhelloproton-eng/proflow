# @tomflow/proflow-platform-host

Local application composition root for ProFlow. It constructs the independent Task and Agent packages, binds HTTP public clients for Execution and Model, exposes a loopback owner router, and aggregates current dependency readiness.

The Host owns no domain repository, business fact, recovery cache, Execution effect, Model provider, or Deployment plan.
