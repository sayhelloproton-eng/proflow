# @tomflow/proflow-execution-runtime — Module Setup

## STEP-EXECUTION-RUNTIME-01 — 准备平台主服务

Responsible: AI
Interactive executable: `platform setup --module platform-host`
Non-interactive executable: `platform setup --module platform-host`
Required inputs: none
Verify: `platform status`
Success condition: `platform-host.setupStatus=READY`.

## STEP-EXECUTION-RUNTIME-02 — 准备模型运行时

Responsible: AI
Interactive executable: `platform setup --module model-runtime`
Non-interactive executable: `platform setup --module model-runtime`
Required inputs: configured FAST and REASON models
Verify: `platform status`
Success condition: `model-runtime.setupStatus=READY`.

## STEP-EXECUTION-RUNTIME-03 — 准备浏览器执行器

Responsible: USER
Interactive executable: `platform setup --module execution-browser-extension`
Non-interactive executable: `platform setup --module execution-browser-extension`
Required inputs: none
Verify: `platform status`
Success condition: `execution-browser-extension.setupStatus=READY`.
