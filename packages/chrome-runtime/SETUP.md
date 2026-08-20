# @tomflow/proflow-chrome-runtime — Module Setup

Chrome is discovered automatically. If no supported executable is found, Module.setup may request the optional `chromeExecutablePath` user override. Rerun setup after the executable is available; the Module must re-observe the real runtime.

## Completion

Setup is complete only when the Module's own `status` reports `setupStatus=READY`. Re-running setup must re-observe reality; it must not resume from a blind historical step index.
