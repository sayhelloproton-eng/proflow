# @tomflow/proflow-execution-local

In-process real local executor for typed ProFlow Execution capabilities.

Normative source: `spec/执行领域/04-模块/execution-local/TECHNICAL-DESIGN.md`.

## File Bridge materialization role

For GPT→platform files, Gateway owns OpenAI transport normalization while this executor performs the bounded local/network materialization under Execution policy and returns artifact metadata/evidence inputs. Context Pack/Patch are artifact forms, not new services, and candidate file existence never means the real effect succeeded.
