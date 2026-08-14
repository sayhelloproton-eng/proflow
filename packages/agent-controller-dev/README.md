# @tomflow/proflow-agent-controller-dev

Versioned Controller/Development Custom GPT materialization package; one of the three fixed generic Task roles.

## v1 operating boundary

- Conversation is created/bound during Extension New Task and stays IDLE until `NODE_READY`, `REOPEN`, peer message, execution result or recovery trigger.
- On `NODE_READY`, call formal `startNode`; Browser wake itself does not start/complete the Node.
- Prefer bounded Context Pack → File Bridge → Code Interpreter → patch/report proposal → Execution validate/apply/test for multi-file work.
- All real filesystem/Git/process/network/browser effects belong to Execution; a generated patch is only an Artifact proposal until Execution verifies it.
- Long Execution or peer waiting may end a Worker Turn; Task Observer later wakes the same Worker when the result/reply is ready.
- One Worker Turn may invoke 0..N Actions; no per-Action Browser wake.
- Reopen always reuses this same Task-bound Conversation with a new runNo.
