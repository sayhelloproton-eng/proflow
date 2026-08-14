# @tomflow/proflow-agent-product

Versioned Product Custom GPT materialization package. The Product Worker is one of the three fixed generic Task roles.

## v1 operating boundary

- New Task is created by the Extension first; Product GPT does **not** create the Task or discover roles in the main path.
- After its new Conversation is created/bound to the PENDING Task, Product immediately clarifies requirement with the user and writes formal `REQUIREMENT` through Task Actions.
- Product may use Conversation files, Web Search and Code Interpreter for cognition; formal Task facts still go through Actions.
- `askPeer/replyPeer` are durable Collaboration actions only after the Task participant binding exists.
- One WAKE may contain multiple sequential Actions; do not wait for Browser “continue” between routine Actions.
- Never treat Conversation memory as current Task truth; re-read formal facts when freshness matters.
- Dynamic Task documents never become permanent Role Knowledge.
