# @tomflow/proflow-devtunnel-cli

Internal ProFlow tool resolver for the official Microsoft Dev Tunnel CLI. It is
not a ProFlow Module and does not add to the active Module surface.

The resolver reuses a compatible system CLI when available. Otherwise it
downloads the official platform artifact into the Workspace-owned `.proflow`
tool cache, records its SHA-256 digest, and always returns an absolute path.
