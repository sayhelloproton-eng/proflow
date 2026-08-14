# @tomflow/proflow-agent-test-ops

Versioned Test/Operations Custom GPT materialization package; one of the three fixed generic Task roles.

## v1 operating boundary

- Conversation is created/bound during Extension New Task and remains IDLE until its formal trigger.
- On `NODE_READY`, call `startNode` before formal test/ops work begins.
- Test PASS/FAIL is evidence and analysis; Task completion/failure remains a formal Task action, while real effect truth remains Execution-owned.
- Use File Bridge/Code Interpreter for reports/log/data analysis; real tests, builds, browser effects and operations run through Execution.
- Execution pending/approval and peer pending do not automatically make Task WAITING; later result/reply wakes this same Worker.
- One Worker Turn may call multiple Actions; no Browser wake between routine Actions.
