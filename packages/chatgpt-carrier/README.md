# chatgpt-carrier

Domain Owner: deployment-governance
Module Kind: external-resource
Service: none
Process: none
Business Fact Owner: none

## Purpose

`chatgpt-carrier` is the Deployment-owned observer for **ChatGPT Web availability**. It does not own or mirror any concrete Agent Role, GPT URL, Action schema, Bearer credential, Knowledge or capability verification.

Current setup is machine-observed:

```text
platform setup --module chatgpt-carrier
→ probe current ChatGPT Web availability
→ READY or ACTION_REQUIRED
```

No GPT URL paste or capability confirmation is required.

## Does NOT own

- Agent Role / roleRef / carrierUrl truth.
- GPT Instructions / Actions / Auth / Knowledge / Capabilities truth.
- Worker or Conversation identity.
- Custom GPT materialization state.
## Owning flow for concrete GPTs

Concrete GPT readiness is established elsewhere:

```text
Agent Package material
→ Browser Extension provisioning
→ Agent Runtime Role Registry / credential
→ Gateway authenticated probe
```

That flow owns behavior/capability readiness. Exact ChatGPT model id remains advisory. Stable Conversation c-id is not supplied by Actions and is observed later by the Browser Carrier during Worker creation.

## Failure boundary

A reachable ChatGPT Web page does **not** independently prove any Agent Role is READY. Conversely, a concrete Role setup problem is not copied into this external-resource module. This module only reports current ChatGPT Web external availability.
