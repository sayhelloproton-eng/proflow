## 0.1.62

### Patch Changes

- Retry the same ChatGPT Action Permission after a transient browser.permission.classify failure instead of permanently caching PERMISSION_CLASSIFICATION_FAILED, while preserving deduplication for stable human-required outcomes.
