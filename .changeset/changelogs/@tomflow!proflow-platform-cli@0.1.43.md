## 0.1.43

### Patch Changes

- Close the Fresh deployment deadlock between Custom GPT provisioning and Gateway runtime startup: materialize the Agent Runtime owned durable Role credential store during deployment setup, and temporarily bootstrap only the required service dependency closure while agent-package setup performs real Gateway health and authenticated Action verification.
