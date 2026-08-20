# @tomflow/proflow-chrome-runtime — Module Setup

## Goal
Reach `setupStatus=READY` with automatic Chrome discovery whenever possible.

## Step 1 — Auto-detect Chrome
**Type:** automatic
**Executable:** `platform setup --module chrome-runtime --workspace <workspace>`
If a supported Chrome/Chromium executable is found, no user action is required.

## Step 2 — Provide an override only when auto-detection fails
**Type:** conditional human input
**Human action:** Install Chrome/Chromium or identify the executable path.
**Verify/commit executable:** `platform setup --module chrome-runtime --workspace <workspace> --input '{"chromeExecutablePath":"<absolute-path>"}'`

## Step 3 — Verify completion
**Type:** automatic verification
**Executable:** `platform status --workspace <workspace>`
**Success condition:** `chrome-runtime.setupStatus=READY`.
