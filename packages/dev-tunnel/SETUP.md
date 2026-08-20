# @tomflow/proflow-dev-tunnel — Module Setup

Authenticate with Microsoft Dev Tunnels when requested, create or select the required tunnel, and allow the Module to establish and verify the public HTTPS ingress. The resulting tunnel id/public URL/evidence are Module-owned state or shared facts, not values to copy into Platform config.

## Completion

Setup is complete only when the Module's own `status` reports `setupStatus=READY`. Re-running setup must re-observe reality; it must not resume from a blind historical step index.
