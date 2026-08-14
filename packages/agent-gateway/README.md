# @tomflow/proflow-agent-gateway

The sole Custom GPT Actions HTTP ingress and OpenAI transport anti-corruption layer.

It authenticates role-scoped credentials, validates typed body/path/query identity, routes business-purpose Actions to owner contracts, and normalizes File Bridge transport. It is stateless with respect to Worker Turns and owns no Task/Execution/Artifact/File business store. Product GPT-facing New Task `createTask/listRegisteredRoles/getRegisteredRole` is not part of the v1 main Action surface; New Task is Extension-first.
