# @tomflow/proflow-agent-runtime

Agent-owned Role Registry, role credential binding, Task-bound worker-context defensive validation, and Collaboration durable runtime. Durable Worker binding itself remains Task-owned.

v1 uses exactly three generic Agent Packages. Role Registry list/get is a management/Deployment/Carrier lookup surface, not Product New Task dynamic discovery. Task owns `agentPackageRef→roleRef/workerRef/conversationLocator` binding; Agent Runtime validates authenticated role/worker context without mirroring that Task truth. Collaboration owns `askPeer/replyPeer` facts only and does not create Task Nodes or Browser scheduling state.

Normative source: `spec/智能体运行与协作领域/`.
