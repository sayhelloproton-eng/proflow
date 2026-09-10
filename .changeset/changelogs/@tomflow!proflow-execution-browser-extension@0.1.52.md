## 0.1.52

### Patch Changes

- Harden Custom GPT provisioning against ChatGPT Builder UI drift by restricting Action schema targeting to visible OpenAPI controls, treating automatic returns to Configure as idempotent success, and failing closed on visible draft/save errors.
