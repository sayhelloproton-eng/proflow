# Primitive｜Round / PID / Log / UNKNOWN Recovery

> 用于真实 install/setup/release/browser journey 等自然长步骤，避免 Chat 长任务、重复执行和跨 Chat 误杀进程。

## 每轮身份

每个自然长步骤固定登记：

```text
ROUND_ID
目标 / owning flow
PID（仅本轮自己创建）
独立 log / archived output
开始时间
预期 STOP POINT
```

Local Dev 的进程视图可能包含其它 Chat 的命令；未知 PID 只观察，不擅自 kill。只管理本轮明确登记的 PID。

## 轮询

启动一次后低频读取；根据产品历史耗时选择合理间隔。不要连续 1～2 秒高频 polling，也不要因为暂时无输出就再启动第二份同命令。

终端 session 被工具回收时，优先读取 archived `read_process_output(pid, offset=-N)` / 已有 log；不要把“session 不在 active list”解释成命令未执行。

## UNKNOWN

幂等 read/test 可在确认无副作用后重跑；publish/create remote resource/install/update/migration 等非幂等动作 timeout/UNKNOWN 时必须先读 Git/Registry/Workspace/remote state，确定上一步到底发生了什么，再继续。

## Timeout evidence preservation

timeout 是“命令未在预算内完整结束”，不是“此前输出无效”。任何 bounded runner 在 timeout/kill 时都必须保留已收到的 stdout/stderr，并额外标记 timeout；禁止用 `command timed out` 覆盖 partial stderr/stdout。

恢复判断顺序固定：**先消费已获得的确定性 evidence → 若仍不足才进入 fallback/retry → 仍 UNKNOWN 才 STOP**。只有 timeout 且没有确定性 evidence 时，才允许按对应 Runbook 发起下一层 bounded diagnostic。

每轮结束将“可复用经验”提炼到 Package/Primitive/Flow；Round 原始过程进入历史，不塞进 CURRENT。
